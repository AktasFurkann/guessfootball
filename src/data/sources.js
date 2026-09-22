/**
 * Genis veri seti kaynaklari.
 *
 * - LEAGUES: guncel kadrolari cekilecek lig (musabaka) ID'leri.
 * - NATIONAL_TEAMS: milli takim isimleri (arama ile ID'ye cozulur).
 * - LEGENDS: gecmisten efsane oyuncu isimleri (arama ile ID'ye cozulur).
 *
 * Kadro/kulup ID'leri Transfermarkt'tan otomatik toplanir; isim listeleri
 * schnellsuche ile ID'ye cevrilir. Listeler istenildigi gibi genisletilebilir.
 */

// Buyuk ligler (Transfermarkt musabaka kodlari)
export const LEAGUES = [
  { id: 'GB1', name: 'Premier Lig' },
  { id: 'ES1', name: 'LaLiga' },
  { id: 'IT1', name: 'Serie A' },
  { id: 'L1', name: 'Bundesliga' },
  { id: 'FR1', name: 'Ligue 1' },
  { id: 'TR1', name: 'Süper Lig' },
  { id: 'NL1', name: 'Eredivisie' },
  { id: 'PO1', name: 'Primeira Liga' },
  { id: 'SA1', name: 'Suudi Pro Lig' },
  { id: 'MLS1', name: 'MLS' },
  { id: 'BE1', name: 'Belçika Pro Lig' },
  { id: 'GB2', name: 'Championship' },
];

// Milli takimlar - Dunya Kupasi'nin baslica ulkeleri (arama ile ID'ye cozulur)
export const NATIONAL_TEAMS = [
  'Türkiye', 'Arjantin', 'Brezilya', 'Fransa', 'Almanya', 'İspanya', 'İtalya',
  'İngiltere', 'Portekiz', 'Hollanda', 'Belçika', 'Hırvatistan', 'Uruguay',
  'Meksika', 'ABD', 'Kolombiya', 'Şili', 'Japonya', 'Güney Kore', 'Senegal',
  'Fas', 'Kamerun', 'Nijerya', 'Gana', 'Cezayir', 'Mısır', 'Danimarka',
  'İsveç', 'İsviçre', 'Polonya', 'Sırbistan', 'Avusturya', 'Galler',
  'İskoçya', 'Çekya', 'Rusya', 'Ukrayna', 'Ekvador', 'Peru', 'Paraguay',
  'Kosta Rika', 'Avustralya', 'İran', 'Suudi Arabistan', 'Katar', 'Tunus',
];

// Efsaneler - seçilmiş isimler (arama ile ID'ye çözülür).
// (İlk 80 listemizdeki isimler dahil edilse de collectIds tekrarları eler.)
export const LEGENDS = [
  // Türkiye / Süper Lig efsaneleri
  'Nihat Kahveci', 'Sergen Yalçın', 'Ümit Karan', 'Rüştü Reçber', 'Alpay Özalan',
  'Hasan Şaş', 'Arif Erdem', 'Tugay Kerimoğlu', 'Bülent Korkmaz', 'Emre Belözoğlu',
  'İlhan Mansız', 'Rıdvan Dilmen', 'Metin Oktay', 'Tanju Çolak', 'Feyyaz Uçar',
  'Oğuz Çetin', 'Hamit Altıntop', 'Gökhan Zan', 'Sabri Sarıoğlu', 'Fatih Terim',
  'Aykut Kocaman', 'Tümer Metin', 'Nihat Doğan', 'Ergün Penbe', 'Suat Kaya',
  'Abdullah Ercan', 'Okan Buruk', 'Ümit Davala', 'Fatih Akyel', 'Volkan Demirel',
  'Selçuk İnan', 'Gökhan Gönül', 'Semih Şentürk', 'Mehmet Aurelio', 'Deniz Barış',
  // Dünya efsaneleri (ilk 80'de olmayanlar öncelikli)
  'Pelé', 'Johan Cruyff', 'Franz Beckenbauer', 'Michel Platini', 'Marco van Basten',
  'Ruud Gullit', 'Frank Rijkaard', 'Lothar Matthäus', 'Gary Lineker', 'Romário',
  'Rivaldo', 'Cafu', 'Roberto Baggio', 'Paolo Rossi', 'Gabriel Batistuta',
  'George Weah', 'Hristo Stoichkov', 'Davor Šuker', 'Zvonimir Boban', 'Robert Prosinečki',
  'Luís Figo', 'Rui Costa', 'Deco', 'Nuno Gomes', 'Pauleta',
  'Michael Owen', 'Alan Shearer', 'Steven Gerrard', 'Rio Ferdinand', 'John Terry',
  'Ashley Cole', 'Sol Campbell', 'Patrick Vieira', 'Robert Pirès', 'Emmanuel Petit',
  'Marcel Desailly', 'Lilian Thuram', 'Youri Djorkaeff', 'Christophe Dugarry', 'Fabien Barthez',
  'David Trezeguet', 'Claude Makélélé', 'Ludovic Giuly', 'Eric Cantona', 'David Ginola',
  'Jürgen Klinsmann', 'Oliver Kahn', 'Michael Ballack', 'Miroslav Klose', 'Philipp Lahm',
  'Bastian Schweinsteiger', 'Bernd Schuster', 'Karl-Heinz Rummenigge', 'Rudi Völler', 'Andreas Brehme',
  'Gianfranco Zola', 'Christian Vieri', 'Filippo Inzaghi', 'Fabio Cannavaro', 'Franco Baresi',
  'Giuseppe Bergomi', 'Demetrio Albertini', 'Gianluca Vialli', 'Roberto Mancini', 'Marco Materazzi',
  'Andrea Barzagli', 'Gianluigi Buffon', 'Fernando Hierro', 'Fernando Redondo', 'Míchel',
  'Emilio Butragueño', 'Luis Enrique', 'Guti', 'David Villa', 'Fernando Torres',
  'Xabi Alonso', 'Marcelo', 'Dani Alves', 'Ronaldinho', 'Ronaldo',
  'Kaká', 'Roberto Carlos', 'Cafu', 'Adriano', 'Robinho',
  'Juan Román Riquelme', 'Javier Zanetti', 'Hernán Crespo', 'Gabriel Heinze', 'Walter Samuel',
  'Diego Forlán', 'Enzo Francescoli', 'Carlos Valderrama', 'Iván Córdoba', 'René Higuita',
  'Iker Casillas', 'Andrés Iniesta', 'Xavi', 'Carles Puyol', 'Raúl',
  'Wesley Sneijder', 'Dennis Bergkamp', 'Edwin van der Sar', 'Clarence Seedorf', 'Patrick Kluivert',
  'Ruud van Nistelrooy', 'Marc Overmars', 'Edgar Davids', 'Phillip Cocu', 'Giovanni van Bronckhorst',
  'Arjen Robben', 'Robin van Persie', 'Rafael van der Vaart', 'Jaap Stam', 'Frank de Boer',
  'Andriy Shevchenko', 'Pavel Nedvěd', 'Petr Čech', 'Jan Koller', 'Milan Baroš',
  'Didier Drogba', 'Samuel Eto\'o', 'Yaya Touré', 'Michael Essien', 'Jay-Jay Okocha',
  'Nwankwo Kanu', 'El Hadji Diouf', 'Frédéric Kanouté', 'Sadio Mané', 'Riyad Mahrez',
  'Radamel Falcao', 'James Rodríguez', 'Alexis Sánchez', 'Arturo Vidal', 'Iván Zamorano',
  'Hidetoshi Nakata', 'Shinji Kagawa', 'Park Ji-sung', 'Tim Cahill', 'Harry Kewell',
  'Zlatan Ibrahimović', 'Henrik Larsson', 'Freddie Ljungberg', 'Olof Mellberg', 'Peter Schmeichel',
  'Michael Laudrup', 'Brian Laudrup', 'Jari Litmanen', 'Luka Modrić', 'Ivan Rakitić',
  'Mario Mandžukić', 'Dejan Stanković', 'Nemanja Vidić', 'Branislav Ivanović', 'Robert Lewandowski',
];
