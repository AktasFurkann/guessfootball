import { Router } from 'express';
import { teams } from '../db.js';

export const teamsRouter = Router();

const MAX_LIMIT = 500;

/**
 * GET /api/teams
 * Tum takim ve logo listesi.
 * ?q= isim araması, ?country= ulke, ?nationalTeam=true|false, ?limit= & ?skip=
 */
teamsRouter.get('/', async (req, res, next) => {
  try {
    const filter = {};

    if (typeof req.query.country === 'string' && req.query.country.trim()) {
      filter.countryName = req.query.country.trim();
    }

    if (req.query.nationalTeam === 'true') filter.isNationalTeam = true;
    if (req.query.nationalTeam === 'false') filter.isNationalTeam = false;

    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      // Aksan/Turkce harf farkina takilmamak icin esnek desen.
      const pattern = req.query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.name = { $regex: pattern, $options: 'i' };
    }

    const limit = Math.min(Number(req.query.limit) || MAX_LIMIT, MAX_LIMIT);
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    const [items, total] = await Promise.all([
      teams().find(filter).sort({ name: 1 }).skip(skip).limit(limit).toArray(),
      teams().countDocuments(filter),
    ]);

    res.json({
      total,
      count: items.length,
      skip,
      teams: items.map((team) => ({
        id: team._id,
        name: team.name,
        shortName: team.shortName,
        abbreviation: team.abbreviation,
        logo: team.crestUrl,
        country: team.countryName,
        isNationalTeam: team.isNationalTeam,
        colors: team.colors,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/teams/:id - tek takim. */
teamsRouter.get('/:id', async (req, res, next) => {
  try {
    const team = await teams().findOne({ _id: String(req.params.id) });
    if (!team) {
      return res.status(404).json({ error: `${req.params.id} ID'li takim bulunamadi.` });
    }

    res.json({
      id: team._id,
      name: team.name,
      shortName: team.shortName,
      abbreviation: team.abbreviation,
      logo: team.crestUrl,
      country: team.countryName,
      isNationalTeam: team.isNationalTeam,
      colors: team.colors,
    });
  } catch (error) {
    next(error);
  }
});
