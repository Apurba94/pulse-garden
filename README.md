# Pulse Garden

A rhythm game whose music is composed on your phone. Blooms grow outward to six rings, and you tap each one as it arrives. The notes you tap
are the melody, so a good run plays the tune, while your flowers fill the garden below.

**[Play it now](https://apurba94.github.io/pulse-garden/)** in your phone's browser, then use "Add to Home Screen" to install it. After the
first visit it works offline.

* 12 generated songs, each with Seedling, Bloom and Thorn charts.
* Multi-touch notes on the hardest charts, plus streak scoring.
* A timing report after each song and a timing offset for wireless headphones.
* No audio files: everything you hear is synthesised live, and the game clock follows the audio clock.

No ads, no accounts, no tracking and no network use after the first load.

## Run from source

```bash
npx serve .
npm test
```

Plain JavaScript with no dependencies. `src/logic.js` holds the composer, charts and scoring, and `src/main.js` holds the screens and audio.

## How it is tested

The tests check that all 36 charts sit on the beat, get denser with difficulty and never ask for an impossible tap, and they check the timing
windows and scoring with simulated perfect, late and absent players. Audio latency differs between phones and could not be measured here,
which is why there is an offset setting. It is worth trying with headphones.

## License

MIT
