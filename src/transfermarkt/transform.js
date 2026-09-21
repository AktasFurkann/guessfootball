/**
 * Transfermarkt'in ham JSON yanitlarini, oyunun tuketecegi sade dokumanlara
 * cevirir. Buradaki her fonksiyon saftir; ag veya veritabani bilmez.
 */

/** `/attributes` yanitindan id -> kayit sozlukleri uretir. */
export function buildLookups(attributes) {
  const index = (list = []) => new Map(list.map((item) => [String(item.id), item]));
  return {
    countries: index(attributes?.countries),
    positions: index(attributes?.positions),
    competitionTypes: index(attributes?.competitionTypes),
  };
}

const countryName = (lookups, id) => lookups.countries.get(String(id))?.name ?? null;

/** Bos/anlamsiz degerleri eleyip dizi olarak uyruklari dondurur. */
function nationalities(profile, lookups) {
  const { nationalityId, secondNationalityId } =
    profile?.nationalityDetails?.nationalities ?? {};
  return [nationalityId, secondNationalityId]
    .filter((id) => id && id > 0)
    .map((id) => countryName(lookups, id))
    .filter(Boolean);
}

function marketValue(details) {
  const current = details?.current;
  if (!current) return null;
  const { prefix = '', content = '', suffix = '' } = current.compact ?? {};
  return {
    value: current.value ?? null,
    currency: current.currency ?? null,
    display: `${prefix}${content}${suffix}`.trim() || null,
    determined: current.determined ?? null,
    highest: details?.highest?.value ?? null,
  };
}

/**
 * Mac mac performans kaydini kulup ve sezon/musabaka bazinda toplar.
 *
 * Yalnizca `participationState === 'played'` olan maclar sayilir; kadroda olup
 * oynamadigi maclar istatistige girmez.
 */
export function aggregatePerformance(performance = []) {
  const clubs = new Map();
  const seasons = new Map();

  for (const entry of performance) {
    const general = entry?.statistics?.generalStatistics;
    if (general?.participationState !== 'played') continue;

    const clubId = entry?.clubsInformation?.club?.clubId;
    if (!clubId) continue;

    const info = entry.gameInformation ?? {};
    const goals = entry.statistics?.goalStatistics ?? {};
    const playingTime = entry.statistics?.playingTimeStatistics ?? {};
    const cards = entry.statistics?.cardStatistics ?? {};

    const season = info.season?.nonCyclicalName ?? String(info.seasonId ?? '');
    const scored = goals.goalsScoredTotal ?? 0;
    const assists = goals.assists ?? 0;
    const minutes = playingTime.playedMinutes ?? 0;
    const date = info.date?.dateTimeUTC ?? null;

    // --- kulup bazli ---
    if (!clubs.has(clubId)) {
      clubs.set(clubId, {
        clubId: String(clubId),
        games: 0,
        goals: 0,
        assists: 0,
        minutes: 0,
        yellowCards: 0,
        seasonSet: new Set(),
        firstDate: date,
        lastDate: date,
      });
    }
    const club = clubs.get(clubId);
    club.games += 1;
    club.goals += scored;
    club.assists += assists;
    club.minutes += minutes;
    club.yellowCards += cards.yellowCardNet ?? 0;
    if (season) club.seasonSet.add(season);
    if (date && (!club.firstDate || date < club.firstDate)) club.firstDate = date;
    if (date && (!club.lastDate || date > club.lastDate)) club.lastDate = date;

    // --- sezon + musabaka bazli ---
    const key = `${season}|${info.competitionId}|${clubId}`;
    if (!seasons.has(key)) {
      seasons.set(key, {
        season,
        seasonId: info.seasonId ?? null,
        competitionId: info.competitionId ?? null,
        clubId: String(clubId),
        games: 0,
        goals: 0,
        assists: 0,
        minutes: 0,
      });
    }
    const bucket = seasons.get(key);
    bucket.games += 1;
    bucket.goals += scored;
    bucket.assists += assists;
    bucket.minutes += minutes;
  }

  const careerByClub = [...clubs.values()]
    .map(({ seasonSet, ...rest }) => ({ ...rest, seasons: seasonSet.size }))
    // Kariyer yolunu kronolojik goster: oyunun ana ipucu bu siralama.
    .sort((a, b) => String(a.firstDate).localeCompare(String(b.firstDate)));

  const careerBySeason = [...seasons.values()].sort(
    (a, b) =>
      (b.seasonId ?? 0) - (a.seasonId ?? 0) ||
      String(a.competitionId).localeCompare(String(b.competitionId)),
  );

  return { careerByClub, careerBySeason };
}

/** Transfer gecmisi yanitini sadelestirir. */
export function mapTransfers(payload) {
  return (payload?.transfers ?? []).map((transfer) => ({
    date: transfer.date ?? null,
    season: transfer.season ?? null,
    fromClub: transfer.from?.clubName ?? null,
    toClub: transfer.to?.clubName ?? null,
    fee: transfer.fee ?? null,
    marketValue: transfer.marketValue ?? null,
  }));
}

/** Piyasa degeri grafigini sadelestirir. */
export function mapMarketValueHistory(payload) {
  return (payload?.list ?? []).map((point) => ({
    date: point.datum_mw ?? null,
    timestamp: point.x ?? null,
    value: point.y ?? null,
    display: point.mw ?? null,
    clubName: point.verein ?? null,
    age: point.age ?? null,
  }));
}

/** Kulup varligini `teams` koleksiyonu dokumanina cevirir. */
export function toTeamDocument(club, lookups) {
  const countryId = club.baseDetails?.countryId ?? null;
  return {
    _id: String(club.id),
    name: club.name ?? null,
    shortName: club.baseDetails?.shortName ?? club.name ?? null,
    abbreviation: club.baseDetails?.abbreviation ?? null,
    // crestUrl varsayilan olarak kucuk boy gelir; profil boyu daha nitelikli.
    crestUrl: club.crestUrl?.replace('medium', 'profil') ?? null,
    countryId,
    countryName: countryName(lookups, countryId),
    isNationalTeam: club.baseDetails?.isNationalTeam ?? false,
    colors: club.baseDetails?.superiorClub?.colors ?? null,
  };
}

/**
 * Profil + toplanmis performans + transfer/piyasa verisini tek `players`
 * dokumaninda birlestirir.
 */
export function toPlayerDocument({
  profile,
  aggregates,
  transfers,
  marketValueHistory,
  clubsById,
  competitionsById,
  lookups,
}) {
  const attributes = profile.attributes ?? {};
  const currentAssignment = (profile.clubAssignments ?? []).find(
    (assignment) => assignment.type === 'current',
  );
  const currentClub = currentAssignment
    ? clubsById.get(String(currentAssignment.clubId))
    : null;

  const careerByClub = aggregates.careerByClub.map((row) => {
    const club = clubsById.get(row.clubId);
    return {
      ...row,
      name: club?.name ?? null,
      crestUrl: club?.crestUrl ?? null,
      countryName: club?.countryName ?? null,
      isNationalTeam: club?.isNationalTeam ?? false,
    };
  });

  const careerBySeason = aggregates.careerBySeason.map((row) => ({
    ...row,
    competitionName: competitionsById.get(row.competitionId)?.name ?? row.competitionId,
    clubName: clubsById.get(row.clubId)?.name ?? null,
  }));

  // Kulup kariyeri toplamlari milli takim maclarini disarida birakir.
  const clubRows = careerByClub.filter((row) => !row.isNationalTeam);
  const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);

  return {
    _id: Number(profile.id),
    name: profile.name ?? null,
    shortName: profile.shortName ?? null,
    fullName: profile.nationalityDetails?.passportName || profile.name || null,
    portraitUrl: profile.portraitUrl ?? null,
    relativeUrl: profile.relativeUrl ?? null,

    dateOfBirth: profile.lifeDates?.dateOfBirth ?? null,
    dateOfDeath: profile.lifeDates?.dateOfDeath ?? null,
    age: profile.lifeDates?.age ?? null,
    placeOfBirth: profile.birthPlaceDetails?.placeOfBirth ?? null,
    countryOfBirth: countryName(lookups, profile.birthPlaceDetails?.countryOfBirthId),
    nationalities: nationalities(profile, lookups),

    // API boyu metre cinsinden verir; oyunda santimetre daha okunakli.
    heightCm: attributes.height ? Math.round(attributes.height * 100) : null,
    foot: attributes.preferredFoot?.name ?? null,
    position: attributes.position
      ? {
          name: attributes.position.name ?? null,
          shortName: attributes.position.shortName ?? null,
          category: attributes.position.category ?? null,
        }
      : null,
    shirtNumber: currentAssignment?.shirtNumber ?? null,
    contractUntil: attributes.contractUntil ?? null,
    formerClubsNote: attributes.formerClubsNote || null,

    currentClub: currentClub
      ? { id: currentClub._id, name: currentClub.name, crestUrl: currentClub.crestUrl }
      : null,
    marketValue: marketValue(profile.marketValueDetails),

    careerTotals: {
      clubs: clubRows.length,
      games: sum(clubRows, 'games'),
      goals: sum(clubRows, 'goals'),
      assists: sum(clubRows, 'assists'),
      minutes: sum(clubRows, 'minutes'),
      seasons: new Set(aggregates.careerBySeason.map((row) => row.season)).size,
    },
    careerByClub,
    careerBySeason,
    transfers,
    marketValueHistory,

    scrapedAt: new Date(),
  };
}
