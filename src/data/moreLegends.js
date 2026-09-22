/**
 * Ek efsane/emekli oyuncu isimleri (DB kapsamini genisletmek icin).
 *
 * Transfermarkt'in isim aramasi (schnellsuche) bulut sunucularindan engelli
 * oldugu icin canli arama Render'da calismiyor; bu yuzden sik aranan taninmis
 * emekli oyuncular onceden cekilip veritabanina eklenir. Liste isimle cozulur
 * (yerelde schnellsuche calisir) ve tmapi ile cekilir.
 */
export const MORE_LEGENDS = [
  // --- Turkiye / Super Lig (guncel-yakin + efsane) ---
  'Burak Yılmaz', 'Arda Turan', 'Tuncay Şanlı', 'Gökhan Töre', 'Umut Bulut',
  'Gökdeniz Karadeniz', 'Servet Çetin', 'Mehmet Topal', 'Selçuk Şahin', 'Yıldıray Baştürk',
  'Nuri Şahin', 'Caner Erkin', 'Gökhan İnler', 'Mevlüt Erdinç', 'Colin Kazım-Richards',
  'Semih Şentürk', 'Deniz Barış', 'Ayhan Akman', 'Ergün Penbe', 'Ümit Karan',
  'Hakan Ünsal', 'Emre Aşık', 'Bülent Korkmaz', 'Hasan Şaş', 'Arif Erdem',
  'Ergün Penbe', 'Suat Kaya', 'Saffet Sancaklı', 'Oktay Derelioğlu', 'Sergen Yalçın',
  'Nihat Kahveci', 'Tayfun Korkut', 'Tugay Kerimoğlu', 'Alpay Özalan', 'Ogün Temizkanoğlu',
  'Abdullah Ercan', 'Tayfur Havutçu', 'Metin Tekin', 'Rıdvan Dilmen', 'Feyyaz Uçar',
  'Tanju Çolak', 'Metin Oktay', 'Cemil Turan', 'Zico (Türk)', 'Mehmet Aurelio',
  'Roberto Carlos', 'İlhan Mansız', 'Ümit Davala', 'Fatih Akyel', 'Volkan Demirel',
  'Rüştü Reçber', 'Gökhan Gönül', 'Sabri Sarıoğlu', 'Emre Belözoğlu', 'Selçuk İnan',
  'Hamit Altıntop', 'Halil Altıntop', 'Tümer Metin', 'Okan Buruk', 'Emre Belözoğlu',
  'Bilica', 'Mehmet Yozgatlı', 'Necati Ateş', 'Ümit Özat', 'Serkan Balcı',
  'Gökhan Zan', 'Egemen Korkmaz', 'Hakan Balta', 'Ceyhun Gülselam', 'Aydın Yılmaz',
  // --- Super Lig yabanci efsaneleri ---
  'Mario Jardel', 'Elano', 'Marcio Nobre', 'Mateja Kežman', 'Milan Baroš',
  'Daniel Güiza', 'Pierre Webó', 'Fernandão', 'Josef de Souza', 'Filip Holosko',
  'Pascal Nouma', 'Jay-Jay Okocha', 'Nicolas Anelka', 'Guti', 'Lukas Podolski',
  'Wesley Sneijder', 'Robin van Persie', 'Dirk Kuyt', 'Raul Meireles', 'Simao Sabrosa',
  'Ricardo Quaresma', 'Deco', 'Fabio Coentrao', 'Bruno Alves', 'Nani',
  'Vincent Aboubakar', 'Demba Ba', 'Moussa Sow', 'Bafétimbi Gomis', 'Emmanuel Emenike',
  'Dani Alves', 'Fernando Muslera', 'Wesley', 'Younes Belhanda', 'Ryan Babel',
  'Robinho', 'Adriano', 'Roberto Carlos', 'Diego', 'Alex Teixeira',
  // --- Dunya efsaneleri (ek) ---
  'Ronaldinho', 'Kaká', 'Rivaldo', 'Cafu', 'Roberto Carlos',
  'Gabriel Batistuta', 'Hernán Crespo', 'Juan Sebastián Verón', 'Pablo Aimar', 'Javier Saviola',
  'Andrés D\'Alessandro', 'Carlos Tevez', 'Juan Román Riquelme', 'Gonzalo Higuaín', 'Ángel Di María',
  'Thierry Henry', 'Patrick Vieira', 'David Trezeguet', 'Robert Pirès', 'Marcel Desailly',
  'Fabien Barthez', 'Bixente Lizarazu', 'Christophe Dugarry', 'Youri Djorkaeff', 'Emmanuel Petit',
  'Alessandro Del Piero', 'Francesco Totti', 'Filippo Inzaghi', 'Christian Vieri', 'Alessandro Nesta',
  'Fabio Cannavaro', 'Gianluca Zambrotta', 'Andrea Pirlo', 'Gennaro Gattuso', 'Daniele De Rossi',
  'Ruud van Nistelrooy', 'Patrick Kluivert', 'Marc Overmars', 'Edgar Davids', 'Clarence Seedorf',
  'Michael Owen', 'Alan Shearer', 'Wayne Rooney', 'Rio Ferdinand', 'Ashley Cole',
  'Fernando Torres', 'David Villa', 'Xabi Alonso', 'Carles Puyol', 'Raúl',
  'Andriy Shevchenko', 'Hristo Stoichkov', 'George Weah', 'Samuel Eto\'o', 'Didier Drogba',
  'Michael Ballack', 'Miroslav Klose', 'Lukas Podolski', 'Bastian Schweinsteiger', 'Philipp Lahm',
  'Petr Čech', 'Frank Lampard', 'Steven Gerrard', 'John Terry', 'Didier Deschamps',
];
