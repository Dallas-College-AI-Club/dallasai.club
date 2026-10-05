// New games register here; the hub, saved-game links and player shell share this list.
export const GAMES = [
  {
    id: 'explore',
    title: 'Dallas Drive',
    genre: '3D EXPLORATION',
    description: 'Seven campuses. A city full of discoveries.',
    accent: '#afd0bb',
    type: 'drive',
    controls: 'By Astra-6 & Minjoo Kim',
    cover: 'assets/dallas-drive-cover.jpg',
    load: null,
  },
  {
    id: 'ride',
    title: 'Retro Ride',
    genre: 'ARCADE RACING',
    description: 'Find your lane. Catch some air. Unlock club discoveries.',
    accent: '#e8b789',
    type: 'bike',
    controls: 'Keyboard · Touch controls',
    preview: { distance: 135, jump: 20 },
    load: () => import('./retro-ride.js'),
  },
  {
    id: 'snake',
    title: 'Snake',
    genre: 'THE CLASSIC, REMIXED',
    description: 'Collect, grow, and uncover updates from the club.',
    accent: '#beb6ef',
    type: 'snake',
    controls: 'Keyboard · Swipe · Touch controls',
    preview: {
      body: [
        [15, 6],
        [14, 6],
        [13, 6],
        [12, 6],
        [12, 7],
        [12, 8],
        [11, 8],
        [10, 8],
        [9, 8],
        [8, 8],
        [8, 9],
        [8, 10],
      ],
      food: [18, 9],
    },
    load: () => import('./snake.js'),
  },
];
export const gameById = (id) => GAMES.find((g) => g.id === id);

// Community games open on their creators' sites, outside the player and rankings.
export const COMMUNITY_GAMES = [
  {
    id: 'swarm',
    title: 'SWARM — The War Council',
    genre: 'AI STRATEGY',
    description:
      'Command five AI agents and watch them reconcile conflicting decisions on the battlefield.',
    accent: '#e8cd78',
    type: 'community',
    controls: 'By Timothy Chan',
    cover: 'assets/swarm-cover.jpg',
    coverAlt: 'SWARM — The War Council title screen',
    coverLabel: 'Inspired by AWS Agentic Football Cup',
    href: 'https://tjchan001.github.io/DallasCollegeAISwarm/',
  },
];
