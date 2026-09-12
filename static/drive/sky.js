import { WeatherCycle } from './weather-cycle.js';
import * as T from '../vendor/three.module.js';
const SEASONS = {
  spring: { ground: '#728979', leaves: '#68916c' },
  summer: { ground: '#6c806e', leaves: '#4f755b' },
  autumn: { ground: '#8d8670', leaves: '#ae7e4f' },
  winter: { ground: '#b1bab8', leaves: '#79887e' },
};
const WEATHER = {
  clear: {
    top: '#527fae',
    horizon: '#d7e6e7',
    fog: '#c0d5df',
    cloud: 0.4,
    light: 3,
    sun: '#fff2dc',
    density: 0.00032,
  },
  overcast: {
    top: '#788eaa',
    horizon: '#dce3e6',
    fog: '#c9d2da',
    cloud: 0.82,
    light: 1.7,
    sun: '#e7edf4',
    density: 0.0006,
  },
  rain: {
    top: '#536982',
    horizon: '#abbac7',
    fog: '#92a7b8',
    cloud: 0.94,
    light: 1.05,
    sun: '#dce5ed',
    density: 0.0011,
  },
  sunset: {
    top: '#465d88',
    horizon: '#f1c5a4',
    fog: '#c2a49b',
    cloud: 0.48,
    light: 2.2,
    sun: '#ffbd8e',
    density: 0.00045,
  },
};
export class SkyWeather {
  constructor(world) {
    this.world = world;
    this.weather = 'clear';
    this.season = 'spring';
    this.cycle = new WeatherCycle();
    this.first = true;
    const uniforms = {
      top: { value: new T.Color() },
      horizon: { value: new T.Color() },
      cloud: { value: 0.4 },
      time: { value: 0 },
      sunset: { value: 0 },
    };
    this.sky = new T.Mesh(
      new T.SphereGeometry(6000, 40, 24),
      new T.ShaderMaterial({
        side: T.BackSide,
        depthWrite: false,
        uniforms,
        vertexShader:
          'varying vec3 vDirection; void main(){vDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `
   varying vec3 vDirection; uniform vec3 top; uniform vec3 horizon; uniform float cloud; uniform float time; uniform float sunset;
   float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
   float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
   float fbm(vec2 p){float n=0.;float a=.5;for(int i=0;i<5;i++){n+=a*noise(p);p=p*2.03+7.1;a*=.5;}return n;}
   void main(){vec3 d=normalize(vDirection);float h=max(d.y,0.);vec3 color=mix(horizon,top,pow(h,.5));vec3 sd=normalize(vec3(-.45,mix(.55,.08,sunset),-.6));float sun=max(dot(d,sd),0.);color+=vec3(1.,.87,.65)*pow(sun,350.)*.5+vec3(1.,.95,.85)*pow(sun,6000.);vec2 uv=d.xz/(h+.18)*2.2+vec2(time*.004,0.);float n=fbm(uv);float cl=smoothstep(.7-cloud*.42,.87-cloud*.38,n)*smoothstep(0.,.16,h);vec3 cc=mix(vec3(.91,.95,.99),vec3(1.,.78,.66),sunset*.5);cc*=.83+.17*fbm(uv+4.);color=mix(color,cc,cl*.9);gl_FragColor=vec4(color,1.);}
  `,
      }),
    );
    this.sky.renderOrder = -1000;
    world.scene.add(this.sky);
    const positions = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 42;
      positions[i * 3 + 1] = Math.random() * 24;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 42;
    }
    this.rain = new T.Points(
      new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(positions, 3)),
      new T.PointsMaterial({
        color: '#e6f1f7',
        size: 0.035,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      }),
    );
    this.rain.frustumCulled = false;
    world.scene.add(this.rain);
    this.set();
  }
  set(weather = this.weather, season = this.season) {
    this.weather = WEATHER[weather] ? weather : 'clear';
    this.season = SEASONS[season] ? season : 'spring';
    const w = WEATHER[this.weather],
      s = SEASONS[this.season];
    this.target = {
      top: new T.Color(w.top),
      horizon: new T.Color(w.horizon),
      fog: new T.Color(w.fog),
      sun: new T.Color(w.sun),
      ground: new T.Color(s.ground),
      leaves: new T.Color(s.leaves),
      cloud: w.cloud,
      light: w.light,
      sunset: this.weather === 'sunset' ? 1 : 0,
    };
    document.querySelector('#weather-select').value = this.weather;
    document.querySelector('#season-select').value = this.season;
    document.querySelector('#weather-status').textContent =
      this.season[0].toUpperCase() +
      this.season.slice(1) +
      ' · ' +
      (this.weather === 'rain'
        ? this.season === 'winter'
          ? 'Snow'
          : 'Rain'
        : this.weather === 'sunset'
          ? 'Golden hour'
          : this.weather === 'overcast'
            ? 'Cloudy'
            : 'Clear sky');
    this.blend(this.first ? 1 : 0.01);
    this.first = false;
  }
  blend(t) {
    const w = this.world,
      u = this.sky.material.uniforms,
      a = this.target;
    u.top.value.lerp(a.top, t);
    u.horizon.value.lerp(a.horizon, t);
    u.cloud.value += (a.cloud - u.cloud.value) * t;
    u.sunset.value += (a.sunset - u.sunset.value) * t;
    w.scene.fog.color.lerp(a.fog, t);
    w.sun.color.lerp(a.sun, t);
    w.sun.intensity += (a.light - w.sun.intensity) * t;
    w.hemi.intensity = this.weather === 'rain' ? 1.35 : 1.9;
    for (const m of w.leafMaterials || []) m.color.lerp(a.leaves, t);
    w.ground.material.color.lerp(a.ground, t);
    w.ground.material.roughness = this.weather === 'rain' ? 0.48 : 0.86;
    this.rain.material.size = this.season === 'winter' ? 0.1 : 0.04;
    this.rain.material.opacity = this.season === 'winter' ? 0.85 : 0.55;
  }
  update(dt, time) {
    const world = this.world,
      event = this.cycle.step(dt, this);
    if (event) this.set(event.weather, event.season);
    this.blend(world.reduced ? 1 : 1 - Math.exp(-dt * 0.3));
    this.sky.position.copy(world.camera.position);
    this.sky.material.uniforms.time.value = world.reduced ? 0 : time * 0.001;
    world.scene.fog.density = world.overview ? 0 : WEATHER[this.weather].density;
    this.rain.visible = this.weather === 'rain' && !world.overview && !world.reduced;
    this.rain.position.copy(world.position);
    if (this.rain.visible) {
      const a = this.rain.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) {
        a.array[i * 3 + 1] -= dt * (this.season === 'winter' ? 1.5 : 19);
        if (a.array[i * 3 + 1] < 0) a.array[i * 3 + 1] = 24;
      }
      a.needsUpdate = true;
    }
    world.sun.position.set(
      (world.inspect?.x ?? world.position.x) - 25,
      this.weather === 'sunset' ? 18 : 60,
      (world.inspect?.z ?? world.position.z) + 30,
    );
  }
}
