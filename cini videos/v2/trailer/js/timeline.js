// The film's one timing table, in beats of the music (124 BPM, beat 0 = the first frame). The page
// draws from it and audio/build.mjs reads the same file, so picture and sound can't come apart
// when a shot is retimed. 45 s = 93 beats; the drop is beat 16.
(function (root) {
  // named moments, in film beats; shots and sound both key off these
  const K = {
    ringIn: 0.25,          // S1: hollow ring draws
    fromHere: 1,           // "From here" rises
    arcGo: 2.5,            // arc starts drawing, camera starts to travel
    dotLand: 6,            // landing dot hits
    anywhere: 6,           // "to anywhere." with it
    irisOpen: 7.25,        // the dot swells and hollows into a ring that opens S2
    plugIn: 8,             // S2 starts: laptop + phone, wire lights
    checks: [12, 13, 14],  // Plugged in / Unlocked / Ready tick
    ready: 15,             // phone screen goes green
    drop: 16,              // S3: the shutter opens on the app
    pick: 24,              // S4: "Pick a place." world map
    cardsIn: 28,           // gallery cards fly in
    clickCity: 30.5,       // cursor clicks Miami
    city: 32,              // S5: Miami city page
    play: 40,              // S6: "Press play." console
    typeStart: 41,
    typeEnd: 43.5,
    enter: 44,             // return pressed
    drive: 48,             // S7: live drive
    arrive1: 55,           // Faena reached
    fly: 56,               // S8: flight MIA -> JFK
    offline: 57.5,         // airplane mode on (music ducks)
    online: 61,            // back online at JFK
    arrive2: 63,           // ARRIVED · The Plaza
    chapters: 64,          // S9: one city per beat
    numbers: 72,           // S10
    resolve: 80,           // S11: logo
    wordmark: 82.9,
    tagline: 84.6,
    end: 93,
  };
  const shots = [
    ['from-here', 0, 8], ['plug-in', 8, 16], ['anywhere', 16, 24], ['pick', 24, 32],
    ['city', 32, 40], ['play', 40, 48], ['drive', 48, 56], ['fly', 56, 64],
    ['chapters', 64, 72], ['numbers', 72, 80], ['resolve', 80, 93],
  ];
  root.TL = { bpm: 124, fps: 60, dur: 45, K, shots };
})(typeof window !== 'undefined' ? window : globalThis);
