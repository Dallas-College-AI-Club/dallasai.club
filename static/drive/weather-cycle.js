export class WeatherCycle {
  constructor(random = Math.random) {
    this.random = random;
    this.elapsed = 0;
    this.duration = 45 + random() * 30;
    this.automatic = true;
    this.turn = 0;
  }
  step(dt, current) {
    if (!this.automatic) return null;
    this.elapsed += dt;
    if (this.elapsed < this.duration) return null;
    this.elapsed = 0;
    this.duration = 45 + this.random() * 40;
    this.turn++;
    const seasons = ['spring', 'summer', 'autumn', 'winter'];
    const changeSeason = this.turn % 2 === 0;
    const season = changeSeason
      ? seasons[(seasons.indexOf(current.season) + 1 + Math.floor(this.random() * 3)) % 4]
      : current.season;
    const choices =
      current.weather === 'rain'
        ? ['overcast', 'clear', 'sunset']
        : current.weather === 'clear'
          ? ['overcast', 'sunset', 'rain']
          : ['clear', 'rain', 'overcast', 'sunset'];
    const weather = choices[Math.floor(this.random() * choices.length)];
    return { weather, season };
  }
}
