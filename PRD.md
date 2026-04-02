# Planning Guide

A comprehensive, Berkeley-inspired AI club website showcasing technical rigor, research excellence, and student-driven innovation for the Dallas AI Club.

**Experience Qualities**: 
1. **Academic Excellence** - The design should evoke the prestige and intellectual rigor of top-tier university research labs like Berkeley BAIR and MIT CSAIL
2. **Technical Sophistication** - Interface should feel modern and cutting-edge, reflecting the advanced nature of AI research and engineering
3. **Accessible Authority** - While projecting expertise, the site should remain welcoming and encourage students at all levels to participate

**Complexity Level**: Complex Application (advanced functionality, likely with multiple views)
  - This is a multi-page website with navigation, dynamic content sections, blog/updates, project showcases, event calendars, team profiles, and comprehensive resource organization requiring sophisticated state management and routing.

## Essential Features

### Navigation & Routing
- **Functionality**: Multi-page navigation system with smooth transitions between major sections (Home, Blog, About, Leadership, Projects, Workshops, Research, Events, Resources, Join)
- **Purpose**: Organize extensive content into logical sections while maintaining easy access
- **Trigger**: User clicks navigation links or scrolls through sections
- **Progression**: User clicks nav item → smooth scroll/transition to section → section animates into view → content becomes interactive
- **Success criteria**: All sections accessible within 2 clicks, smooth transitions, clear active state indication

### Blog/Updates Section
- **Functionality**: Display club updates, meeting notes, and announcements in a blog-style format
- **Purpose**: Keep members informed about club activities, decisions, and upcoming events
- **Trigger**: User navigates to Blog section or clicks "Latest Updates" on home
- **Progression**: Section loads → blog post displays with structured content → user reads updates → CTAs to join Discord/GitHub
- **Success criteria**: Blog posts clearly formatted, easy to read on all devices, CTAs prominent and functional

### Hero Section
- **Functionality**: Bold landing area with club tagline, visual identity, and primary CTA
- **Purpose**: Immediately communicate club mission and encourage membership
- **Trigger**: Page load
- **Progression**: Page loads → hero fades in with stagger → tagline animates → CTA pulses subtly
- **Success criteria**: Captures attention, communicates mission within 3 seconds, CTA click-through to Join section

### Featured Projects Showcase
- **Functionality**: Grid/carousel of active and past projects with demos, descriptions, and team info
- **Purpose**: Demonstrate technical capabilities and attract prospective members
- **Trigger**: User navigates to Projects section or views featured projects on home
- **Progression**: Section enters viewport → project cards animate in → user hovers/clicks → expanded view with details, tech stack, team, links
- **Success criteria**: Projects clearly categorized (Beginner/Intermediate/Advanced), filtering works, external links functional

### Leadership Team Profiles
- **Functionality**: Officer profiles with photos, bios, roles, and contact info organized by division
- **Purpose**: Build trust, show organizational structure, make leadership accessible
- **Trigger**: User navigates to Leadership section
- **Progression**: Section loads → org chart displays → user clicks officer → modal/expansion shows full bio and responsibilities
- **Success criteria**: All officers visible, clear hierarchy, "How to become an officer" info prominent

### Workshop Calendar & Tracks
- **Functionality**: Schedule of workshops organized by difficulty track (Beginner/Intermediate/Advanced)
- **Purpose**: Show learning pathways and encourage attendance
- **Trigger**: User navigates to Workshops section
- **Progression**: Calendar view loads → user filters by track → workshop cards show → click for details/registration
- **Success criteria**: Clear track differentiation, upcoming workshops prominent, past workshops archived

### Research Section
- **Functionality**: Reading groups, paper discussions, research sprints, replication projects
- **Purpose**: Highlight research-oriented activities and academic rigor
- **Trigger**: User navigates to Research section
- **Progression**: Section loads → current reading group visible → papers listed → research sprint info shown → user can see how to participate
- **Success criteria**: Current paper discussions visible, research sprint format explained, collaboration opportunities clear

### Events List
- **Functionality**: Upcoming and past events (speakers, hackathons, socials) with dates and descriptions
- **Purpose**: Drive engagement and attendance
- **Trigger**: User navigates to Events section or views upcoming events on home
- **Progression**: Events list loads → sorted by date → user clicks event → details expand with time, location, registration link
- **Success criteria**: Next 3 events always visible on home, full calendar in Events section, past events archived

### Resource Library
- **Functionality**: Curated learning paths, course links, tools, papers, textbooks organized by skill level
- **Purpose**: Provide valuable resources and establish club as educational hub
- **Trigger**: User navigates to Resources section
- **Progression**: Resource categories display → user selects category → resources listed with descriptions → external links open in new tab
- **Success criteria**: Learning paths clearly defined (beginner → advanced), Berkeley course links functional, GitHub organization linked

### Join/Membership Form
- **Functionality**: Interest form with Discord invite, meeting schedule, and membership requirements
- **Purpose**: Convert visitors to members
- **Trigger**: User clicks "Join" CTA or navigates to Join section
- **Progression**: Section loads → requirements listed → interest form shown → user fills form → Discord link prominent → confirmation shown
- **Success criteria**: Form submission works, Discord link functional, meeting schedule accurate, low friction to join

## Edge Case Handling

- **No Upcoming Events**: Display "No events scheduled - check back soon!" with CTA to join Discord for updates
- **Empty Project Teams**: Show "Project teams forming soon" with link to project proposal form
- **Broken External Links**: Implement link checker, fallback to archive.org or show "Link unavailable - contact us"
- **Long Officer Bios**: Truncate at 150 characters with "Read more" expansion
- **Mobile Navigation**: Hamburger menu with full-screen overlay for extensive nav structure
- **Slow Loading Images**: Skeleton loaders for officer photos and project images
- **Form Validation Errors**: Inline validation with helpful error messages
- **Outdated Workshop Calendar**: Visual indicator for past workshops vs. upcoming

## Design Direction

The design should evoke the intellectual gravitas of Berkeley's top research labs while remaining accessible and inspiring. Think clean academic aesthetics meets modern tech - the visual language of BAIR research papers combined with the polish of contemporary tech startups. The site should feel simultaneously authoritative and welcoming, technical yet human.

## Color Selection

A sophisticated academic palette inspired by Berkeley blue and gold, with contemporary tech accents.

- **Primary Color**: Deep Academic Blue `oklch(0.35 0.12 250)` - Communicates trust, intelligence, and institutional prestige (Berkeley-inspired)
- **Secondary Colors**: 
  - Warm Gold Accent `oklch(0.75 0.15 85)` - Represents achievement, excellence, and optimism
  - Neutral Slate `oklch(0.25 0.01 250)` - Professional, technical, grounding color for text
- **Accent Color**: Vibrant Electric Cyan `oklch(0.7 0.19 200)` - Modern tech energy, highlights CTAs and interactive elements
- **Foreground/Background Pairings**:
  - Background (Soft Warm White `oklch(0.98 0.01 85)`): Slate text `oklch(0.25 0.01 250)` - Ratio 13.2:1 ✓
  - Primary (Academic Blue `oklch(0.35 0.12 250)`): White text `oklch(1 0 0)` - Ratio 8.5:1 ✓
  - Accent (Electric Cyan `oklch(0.7 0.19 200)`): Slate text `oklch(0.25 0.01 250)` - Ratio 4.9:1 ✓
  - Card (Subtle Off-White `oklch(0.995 0.005 85)`): Slate text - Ratio 13.8:1 ✓

## Font Selection

Typography should reflect academic authority while maintaining modern readability - a pairing that bridges research papers and contemporary web design.

- **Primary Font**: **Space Grotesk** - Geometric, technical feel perfect for headings and the AI/tech context
- **Secondary Font**: **IBM Plex Sans** - Rational, clean, highly legible for body text with a subtle technical character
- **Mono Font**: **JetBrains Mono** - For code snippets, technical details, and project tech stacks

- **Typographic Hierarchy**:
  - H1 (Hero Title): Space Grotesk Bold/56px/tight letter-spacing (-0.02em)/line-height 1.1
  - H2 (Section Headers): Space Grotesk Bold/40px/tight letter-spacing (-0.01em)/line-height 1.2
  - H3 (Subsection Headers): Space Grotesk SemiBold/28px/normal spacing/line-height 1.3
  - H4 (Card Titles): Space Grotesk Medium/20px/normal spacing/line-height 1.4
  - Body (Paragraph): IBM Plex Sans Regular/16px/normal spacing/line-height 1.6
  - Small (Captions): IBM Plex Sans Regular/14px/normal spacing/line-height 1.5
  - Code/Tech: JetBrains Mono Regular/14px/normal spacing/line-height 1.5

## Animations

Animations should reinforce the sense of precision and technical excellence - think physics-based micro-interactions and smooth, purposeful transitions that feel engineered rather than decorative.

- **Page Transitions**: Subtle fade with slight upward motion (20px) on section entry, 400ms ease-out
- **Hero Elements**: Staggered fade-in on load - tagline → description → CTA with 100ms delays
- **Project Cards**: Scale-up on hover (1.02), shadow intensifies, 200ms spring physics
- **Navigation**: Smooth scroll with easing, active indicator slides with 300ms ease
- **CTAs**: Subtle pulse on primary "Join" button (scale 1.0 → 1.05), glow effect on hover
- **Form Interactions**: Input field highlight expands on focus, success checkmark animates with bounce
- **Content Reveal**: Elements fade and slide up as they enter viewport (Intersection Observer)
- **Delightful Moments**: Officer card flip on click, confetti on form submission, subtle particle effect on hero background

## Component Selection

- **Components**:
  - **Navigation**: Custom nav with smooth scroll behavior, desktop horizontal + mobile drawer
  - **Hero**: Custom full-height section with background pattern, typography hierarchy, Button (shadcn)
  - **Cards**: Card (shadcn) for projects, events, workshops with consistent hover states
  - **Officer Profiles**: Avatar (shadcn) + Dialog (shadcn) for expanded bios
  - **Forms**: Form (shadcn) + Input (shadcn) + Button (shadcn) + Textarea (shadcn) for join/contact
  - **Calendar**: Custom calendar component or Accordion (shadcn) for workshop timeline
  - **Tabs**: Tabs (shadcn) for switching between Beginner/Intermediate/Advanced tracks
  - **Lists**: Custom cards in grid layouts for projects, resources, events
  - **Toast**: Sonner for form submission confirmations
  - **Scroll Area**: ScrollArea (shadcn) for resource lists
  - **Separator**: Separator (shadcn) for visual breaks between sections
  - **Badge**: Badge (shadcn) for difficulty levels, tags, tech stack

- **Customizations**:
  - Custom hero section with animated background pattern (geometric grid or subtle noise)
  - Custom project showcase with filter/sort functionality
  - Custom org chart visualization for leadership structure
  - Custom timeline component for workshop schedule

- **States**:
  - Buttons: Default (solid primary/gradient), Hover (brightness increase + shadow), Active (slight scale down), Disabled (reduced opacity)
  - Inputs: Default (border), Focus (border glow + ring), Error (red border + message), Success (green border + checkmark)
  - Cards: Default (subtle shadow), Hover (shadow intensifies + lift), Active/Selected (border highlight)
  - Links: Default (underline on hover), Active section (bold + indicator)

- **Icon Selection**:
  - Phosphor Icons for consistency
  - Navigation: House, Users, FolderOpen, Presentation, FlaskConical, Calendar, BookOpen, SignIn
  - Actions: ArrowRight (CTAs), Plus (add/propose), Download, ExternalLink
  - Social: DiscordLogo, GithubLogo, LinkedinLogo
  - Features: ChartBar (projects), GraduationCap (workshops), Atom (research), Confetti (events)

- **Spacing**:
  - Section padding: py-20 md:py-28 (large breathing room)
  - Container: max-w-7xl mx-auto px-6 md:px-8
  - Card padding: p-6 md:p-8
  - Grid gaps: gap-6 md:gap-8 (generous spacing between cards)
  - Element spacing: space-y-4 for text blocks, space-y-6 for larger components

- **Mobile**:
  - Navigation: Hamburger menu with Sheet (shadcn) full-screen overlay
  - Hero: Single column, reduced font sizes (H1: 36px), adjusted line heights
  - Project Grid: 1 column mobile → 2 col tablet → 3 col desktop
  - Officer Profiles: 1 column mobile → 2 col tablet → 3-4 col desktop
  - Forms: Full-width inputs, adjusted spacing
  - Tabs: Horizontal scroll on mobile for track selection
  - Footer: Stacked columns on mobile
  - Touch targets: Minimum 44px for all interactive elements
