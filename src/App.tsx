import { useState } from 'react'
import { motion } from 'framer-motion'
import { 
  House, Users, FolderOpen, Presentation, Flask, 
  Calendar, BookOpen, SignIn, ArrowRight, GithubLogo, 
  DiscordLogo, GraduationCap, Atom, Confetti, ChartBar,
  Plus, ArrowSquareOut, List, Newspaper
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { toast } from 'sonner'
import { BlogPost } from '@/components/BlogPost'

type NavSection = 'home' | 'blog' | 'about' | 'leadership' | 'projects' | 'workshops' | 'research' | 'events' | 'resources' | 'join'

function App() {
  const [activeSection, setActiveSection] = useState<NavSection>('home')
  const [selectedOfficer, setSelectedOfficer] = useState<Officer | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const scrollToSection = (section: NavSection) => {
    setActiveSection(section)
    setMobileMenuOpen(false)
    const element = document.getElementById(section)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' })
    }
  }

  const handleJoinSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)
    const data = Object.fromEntries(formData)
    console.log('Join form submitted:', data)
    toast.success('Welcome to Dallas AI Club! Check your email for next steps.')
    form.reset()
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation 
        activeSection={activeSection} 
        scrollToSection={scrollToSection}
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
      />
      
      <main>
        <HeroSection scrollToSection={scrollToSection} />
        <BlogPost />
        <AboutSection />
        <LeadershipSection selectedOfficer={selectedOfficer} setSelectedOfficer={setSelectedOfficer} />
        <ProjectsSection />
        <WorkshopsSection />
        <ResearchSection />
        <EventsSection />
        <ResourcesSection />
        <JoinSection onSubmit={handleJoinSubmit} />
      </main>

      <Footer scrollToSection={scrollToSection} />
    </div>
  )
}

function Navigation({ 
  activeSection, 
  scrollToSection,
  mobileMenuOpen,
  setMobileMenuOpen
}: { 
  activeSection: NavSection
  scrollToSection: (section: NavSection) => void
  mobileMenuOpen: boolean
  setMobileMenuOpen: (open: boolean) => void
}) {
  const navItems: { id: NavSection; label: string; icon: React.ReactElement }[] = [
    { id: 'home', label: 'Home', icon: <House /> },
    { id: 'blog', label: 'Blog', icon: <Newspaper /> },
    { id: 'about', label: 'About', icon: <Atom /> },
    { id: 'leadership', label: 'Leadership', icon: <Users /> },
    { id: 'projects', label: 'Projects', icon: <FolderOpen /> },
    { id: 'workshops', label: 'Workshops', icon: <Presentation /> },
    { id: 'research', label: 'Research', icon: <Flask /> },
    { id: 'events', label: 'Events', icon: <Calendar /> },
    { id: 'resources', label: 'Resources', icon: <BookOpen /> },
    { id: 'join', label: 'Join', icon: <SignIn /> },
  ]

  return (
    <motion.nav 
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className="fixed top-0 left-0 right-0 z-50 bg-card/80 backdrop-blur-lg border-b border-border"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-4">
        <div className="flex items-center justify-between">
          <button 
            onClick={() => scrollToSection('home')}
            className="text-xl font-bold tracking-tight hover:text-primary transition-colors"
          >
            Dallas AI
          </button>

          <div className="hidden lg:flex items-center gap-1">
            {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                  activeSection === item.id 
                    ? 'bg-primary text-primary-foreground' 
                    : 'hover:bg-muted'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="lg:hidden">
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <List size={24} />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[300px]">
                <div className="flex flex-col gap-4 mt-8">
                  {navItems.map(item => (
                    <button
                      key={item.id}
                      onClick={() => scrollToSection(item.id)}
                      className={`px-4 py-3 rounded-lg text-left font-medium transition-all flex items-center gap-3 ${
                        activeSection === item.id 
                          ? 'bg-primary text-primary-foreground' 
                          : 'hover:bg-muted'
                      }`}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  ))}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </motion.nav>
  )
}

function HeroSection({ scrollToSection }: { scrollToSection: (section: NavSection) => void }) {
  return (
    <section id="home" className="relative min-h-screen flex items-center justify-center hero-pattern gradient-mesh pt-20">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-20 md:py-28">
        <div className="max-w-4xl mx-auto text-center">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-5xl md:text-7xl font-bold tracking-tight mb-6"
            style={{ letterSpacing: '-0.02em', lineHeight: 1.1 }}
          >
            Build, Learn, Research.
          </motion.h1>
          
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-xl md:text-2xl text-muted-foreground mb-8 leading-relaxed"
          >
            A student-driven community at Dallas College focused on building practical AI systems, 
            exploring cutting-edge research, and fostering open collaboration.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Button 
              size="lg" 
              onClick={() => scrollToSection('join')}
              className="group text-lg px-8 py-6 shadow-lg hover:shadow-xl transition-all"
            >
              Join the Club
              <ArrowRight className="ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
            <Button 
              size="lg" 
              variant="outline"
              onClick={() => scrollToSection('blog')}
              className="text-lg px-8 py-6 group"
            >
              <Newspaper className="mr-2 group-hover:scale-110 transition-transform" />
              Latest Updates
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            <StatCard icon={<ChartBar size={32} />} value="20+" label="Active Projects" />
            <StatCard icon={<GraduationCap size={32} />} value="Weekly" label="Workshops" />
            <StatCard icon={<Users size={32} />} value="100+" label="Members" />
          </motion.div>
        </div>
      </div>
    </section>
  )
}

function StatCard({ icon, value, label }: { icon: React.ReactElement; value: string; label: string }) {
  return (
    <Card className="border-2 hover:border-primary transition-all hover:shadow-lg">
      <CardContent className="p-6 text-center">
        <div className="flex justify-center mb-3 text-primary">{icon}</div>
        <div className="text-3xl font-bold mb-1">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

function AboutSection() {
  return (
    <section id="about" className="py-20 md:py-28 bg-card">
      <div className="max-w-7xl mx-auto px-6 md:px-8">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-6 tracking-tight" style={{ letterSpacing: '-0.01em' }}>
            About Us
          </h2>
          <p className="text-xl text-muted-foreground mb-12 max-w-3xl leading-relaxed">
            The Dallas AI Club is where curiosity meets rigor. We empower students to learn deeply, 
            experiment boldly, and create impactful AI projects.
          </p>

          <div className="grid md:grid-cols-2 gap-8 mb-16">
            <Card className="border-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <Atom size={28} className="text-primary" />
                  Mission & Vision
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground leading-relaxed">
                  Our mission is to empower students to learn deeply, experiment boldly, and create 
                  impactful AI projects that reflect curiosity, rigor, and innovation. We believe in 
                  hands-on engineering, research exploration, and open collaboration.
                </p>
              </CardContent>
            </Card>

            <Card className="border-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <Flask size={28} className="text-primary" />
                  What Makes Us Unique
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground leading-relaxed">
                  Inspired by Berkeley's BAIR and MIT's CSAIL, we combine practical engineering with 
                  academic rigor. From beginner tutorials to research paper replications, we support 
                  every stage of your AI journey.
                </p>
              </CardContent>
            </Card>
          </div>

          <div>
            <h3 className="text-3xl font-bold mb-6">Our Values</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <ValueCard title="Curiosity" description="Ask questions, explore ideas, never stop learning" />
              <ValueCard title="Rigor" description="Build with precision, test thoroughly, document clearly" />
              <ValueCard title="Community" description="Collaborate openly, support each other, share knowledge" />
              <ValueCard title="Impact" description="Create meaningful projects that solve real problems" />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

function ValueCard({ title, description }: { title: string; description: string }) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardContent className="p-6">
        <h4 className="text-xl font-semibold mb-2">{title}</h4>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

interface Officer {
  name: string
  role: string
  division: string
  bio: string
  image?: string
  initials: string
}

function LeadershipSection({ 
  selectedOfficer, 
  setSelectedOfficer 
}: { 
  selectedOfficer: Officer | null
  setSelectedOfficer: (officer: Officer | null) => void 
}) {
  const officers: Officer[] = [
    {
      name: "Phuong Nguyen",
      role: "President",
      division: "Executive Team",
      bio: "Leading our club's vision and strategic direction. Passionate about building practical AI systems and fostering a collaborative learning community at Dallas College.",
      initials: "PN"
    },
    {
      name: "Shirley Bracewell",
      role: "Secretary",
      division: "Executive Team",
      bio: "Managing club documentation, communications, and meeting coordination. Ensuring our community stays organized and informed about all activities.",
      initials: "SB"
    },
    {
      name: "Matthew Haling Htang",
      role: "SGA Representative",
      division: "Executive Team",
      bio: "Serving as our liaison to Student Government Association. Advocating for club needs and connecting us with campus resources and opportunities.",
      initials: "MH"
    },
    {
      name: "Trinh Thi Diem My",
      role: "Treasurer",
      division: "Executive Team",
      bio: "Managing club finances, budgeting, and funding coordination with SGA. Ensuring we have the resources needed for workshops, projects, and events.",
      initials: "TM"
    },
  ]

  const divisions = Array.from(new Set(officers.map(o => o.division)))

  return (
    <section id="leadership" className="py-20 md:py-28">
      <div className="max-w-7xl mx-auto px-6 md:px-8">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-6 tracking-tight">Leadership</h2>
          <Card className="mb-12 border-2 border-primary bg-primary/5">
            <CardContent className="p-8">
              <div className="flex items-start gap-6">
                <Confetti size={48} className="text-primary flex-shrink-0" />
                <div>
                  <h3 className="text-2xl font-bold mb-2">We're Official!</h3>
                  <p className="text-muted-foreground mb-4 leading-relaxed">
                    The Dallas AI Club has been officially approved as a Recognized Student Organization (RSO) 
                    at Dallas College! Our inaugural officers were randomly selected from interested members, 
                    ensuring a fair and inclusive start to our leadership team.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <p className="text-xl text-muted-foreground mb-12 max-w-3xl">
            Our officer team is student-run and student-led. We believe in distributed leadership, 
            mentorship, and empowering members to take ownership.
          </p>

          <div className="mb-12">
            <h3 className="text-2xl font-semibold mb-6 flex items-center gap-3">
              <Badge variant="outline" className="text-base py-1 px-3">Inaugural Officers</Badge>
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {officers.map(officer => (
                <Card 
                  key={officer.name}
                  className="cursor-pointer hover:shadow-lg transition-all hover:scale-[1.02]"
                  onClick={() => setSelectedOfficer(officer)}
                >
                  <CardContent className="p-6">
                    <div className="flex flex-col items-center text-center gap-4 mb-4">
                      <Avatar className="h-20 w-20">
                        <AvatarImage src={officer.image} />
                        <AvatarFallback className="bg-primary text-primary-foreground text-xl">
                          {officer.initials}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h4 className="font-semibold text-lg">{officer.name}</h4>
                        <p className="text-sm text-muted-foreground">{officer.role}</p>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-3">{officer.bio}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <Card className="bg-muted/50 border-2 border-dashed">
            <CardContent className="p-8 text-center">
              <Users size={48} className="mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-xl font-semibold mb-2">Want to Lead?</h3>
              <p className="text-muted-foreground mb-4">
                Officer elections happen each semester. Active members can nominate themselves for leadership positions.
              </p>
              <Button variant="outline">Learn About Officer Roles</Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <Dialog open={selectedOfficer !== null} onOpenChange={() => setSelectedOfficer(null)}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-4 mb-4">
              <Avatar className="h-20 w-20">
                <AvatarImage src={selectedOfficer?.image} />
                <AvatarFallback className="bg-primary text-primary-foreground text-xl">
                  {selectedOfficer?.initials}
                </AvatarFallback>
              </Avatar>
              <div>
                <DialogTitle className="text-2xl">{selectedOfficer?.name}</DialogTitle>
                <DialogDescription className="text-base">{selectedOfficer?.role}</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Badge>{selectedOfficer?.division}</Badge>
            </div>
            <p className="text-muted-foreground leading-relaxed">{selectedOfficer?.bio}</p>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function ProjectsSection() {
  const projects = [
    {
      title: "Campus RAG Assistant",
      description: "Retrieval-augmented chatbot trained on Dallas College course materials and syllabi. Helps students find information instantly.",
      level: "Intermediate",
      tech: ["Python", "LangChain", "Pinecone", "FastAPI"],
      status: "Planned",
      team: 0
    },
    {
      title: "AI Study Group Matcher",
      description: "ML system that matches students based on courses, schedules, and learning styles. Built with collaborative filtering.",
      level: "Beginner",
      tech: ["Python", "scikit-learn", "Flask"],
      status: "Planned",
      team: 0
    },
    {
      title: "Research Paper Summarizer",
      description: "Multi-agent system that generates structured summaries of research papers with citation tracking and key findings extraction.",
      level: "Advanced",
      tech: ["GPT-4", "LangGraph", "PostgreSQL"],
      status: "Planned",
      team: 0
    },
  ]

  return (
    <section id="projects" className="py-20 md:py-28 bg-card">
      <div className="max-w-7xl mx-auto px-6 md:px-8">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-6 tracking-tight">Projects</h2>
          <p className="text-xl text-muted-foreground mb-12 max-w-3xl">
            Our project teams build real AI applications. From beginner-friendly tools to advanced 
            research replications, every project is hands-on and production-focused.
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
            {projects.map((project, idx) => (
              <motion.div
                key={project.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: idx * 0.1 }}
              >
                <Card className="h-full hover:shadow-xl transition-all hover:scale-[1.02] border-2">
                  <CardHeader>
                    <div className="flex items-start justify-between mb-2">
                      <Badge variant={project.status === 'Active' ? 'default' : 'outline'}>
                        {project.status}
                      </Badge>
                      <Badge 
                        variant="secondary"
                        className={
                          project.level === 'Beginner' ? 'bg-green-100 text-green-800' :
                          project.level === 'Intermediate' ? 'bg-blue-100 text-blue-800' :
                          'bg-purple-100 text-purple-800'
                        }
                      >
                        {project.level}
                      </Badge>
                    </div>
                    <CardTitle className="text-xl">{project.title}</CardTitle>
                    <CardDescription className="text-sm">{project.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-2">
                        {project.tech.map(tech => (
                          <Badge key={tech} variant="outline" className="text-xs font-mono">
                            {tech}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Users size={16} />
                        {project.team} members
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          <Card className="bg-accent/10 border-2 border-accent">
            <CardContent className="p-8 text-center">
              <Plus size={48} className="mx-auto mb-4 text-accent" />
              <h3 className="text-xl font-semibold mb-2">Have a Project Idea?</h3>
              <p className="text-muted-foreground mb-4">
                We welcome project proposals from all members. Submit your idea and form a team!
              </p>
              <Button className="bg-accent text-accent-foreground hover:bg-accent/90">
                Submit Project Proposal
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </section>
  )
}

function WorkshopsSection() {
  const workshops = {
    beginner: [
      { title: "Python for AI Basics", week: "Week 1", description: "Variables, functions, NumPy, pandas fundamentals" },
      { title: "Machine Learning 101", week: "Week 2", description: "Supervised learning, regression, classification basics" },
      { title: "Neural Networks from Scratch", week: "Week 3", description: "Understanding backpropagation and gradient descent" },
      { title: "Working with LLM APIs", week: "Week 4", description: "OpenAI API, prompt engineering, practical applications" },
    ],
    intermediate: [
      { title: "RAG Systems Deep Dive", week: "Week 1", description: "Vector databases, embeddings, retrieval strategies" },
      { title: "Building AI Agents", week: "Week 2", description: "LangChain, agent architectures, tool usage" },
      { title: "Model Deployment", week: "Week 3", description: "FastAPI, Docker, scaling AI applications" },
      { title: "Fine-tuning Strategies", week: "Week 4", description: "Transfer learning, LoRA, PEFT techniques" },
    ],
    advanced: [
      { title: "Research Methods in ML", week: "Week 1", description: "Experimental design, ablation studies, reproducibility" },
      { title: "Training LLMs at Scale", week: "Week 2", description: "Distributed training, optimization techniques" },
      { title: "Paper Replication Workshop", week: "Week 3", description: "Implementing recent research papers from scratch" },
      { title: "Contributing to Open Source", week: "Week 4", description: "Hugging Face, PyTorch, making meaningful contributions" },
    ]
  }

  return (
    <section id="workshops" className="py-20 md:py-28">
      <div className="max-w-7xl mx-auto px-6 md:px-8">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-6 tracking-tight">Workshops</h2>
          <p className="text-xl text-muted-foreground mb-12 max-w-3xl">
            Weekly technical workshops for every skill level. Follow a structured track or mix and match 
            based on your interests and experience.
          </p>

          <Tabs defaultValue="beginner" className="w-full">
            <TabsList className="grid w-full max-w-2xl grid-cols-3 mb-8">
              <TabsTrigger value="beginner">Beginner</TabsTrigger>
              <TabsTrigger value="intermediate">Intermediate</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>

            <TabsContent value="beginner">
              <div className="grid md:grid-cols-2 gap-6">
                {workshops.beginner.map((workshop, idx) => (
                  <WorkshopCard key={idx} {...workshop} color="green" />
                ))}
              </div>
            </TabsContent>

            <TabsContent value="intermediate">
              <div className="grid md:grid-cols-2 gap-6">
                {workshops.intermediate.map((workshop, idx) => (
                  <WorkshopCard key={idx} {...workshop} color="blue" />
                ))}
              </div>
            </TabsContent>

            <TabsContent value="advanced">
              <div className="grid md:grid-cols-2 gap-6">
                {workshops.advanced.map((workshop, idx) => (
                  <WorkshopCard key={idx} {...workshop} color="purple" />
                ))}
              </div>
            </TabsContent>
          </Tabs>

          <Card className="mt-12 border-2">
            <CardContent className="p-8">
              <div className="flex items-start gap-6">
                <GraduationCap size={48} className="text-primary flex-shrink-0" />
                <div>
                  <h3 className="text-xl font-semibold mb-2">Workshop Schedule</h3>
                  <p className="text-muted-foreground mb-4">
                    Workshops run every Wednesday at 6:00 PM in the Computer Science Lab. 
                    All materials are recorded and shared on our GitHub.
                  </p>
                  <Button variant="outline">View Full Calendar</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </section>
  )
}

function WorkshopCard({ title, week, description, color }: { 
  title: string
  week: string
  description: string
  color: 'green' | 'blue' | 'purple'
}) {
  const colorClasses = {
    green: 'border-green-200 bg-green-50/50',
    blue: 'border-blue-200 bg-blue-50/50',
    purple: 'border-purple-200 bg-purple-50/50'
  }

  return (
    <Card className={`border-2 ${colorClasses[color]} hover:shadow-lg transition-shadow`}>
      <CardHeader>
        <div className="flex items-center justify-between mb-2">
          <Badge variant="outline">{week}</Badge>
          <Presentation size={20} className="text-muted-foreground" />
        </div>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  )
}

function ResearchSection() {
  const papers = [
    { title: "Attention Is All You Need", authors: "Vaswani et al.", status: "Current" },
    { title: "LoRA: Low-Rank Adaptation", authors: "Hu et al.", status: "Replicating" },
    { title: "Constitutional AI", authors: "Anthropic", status: "Upcoming" },
  ]

  return (
    <section id="research" className="py-20 md:py-28 bg-card">
      <div className="max-w-7xl mx-auto px-6 md:px-8">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-6 tracking-tight">Research</h2>
          <p className="text-xl text-muted-foreground mb-12 max-w-3xl">
            Inspired by Berkeley's BAIR, we run reading groups, paper discussions, and research sprints. 
            Learn to read papers critically and replicate cutting-edge research.
          </p>

          <div className="grid md:grid-cols-2 gap-8 mb-12">
            <Card className="border-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <Flask size={28} className="text-primary" />
                  Reading Groups
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4">
                  Weekly paper discussions where we dissect recent research, understand methodologies, 
                  and explore implications. Open to all levels.
                </p>
                <div className="space-y-2">
                  {papers.map(paper => (
                    <div key={paper.title} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex-1">
                        <div className="font-medium text-sm">{paper.title}</div>
                        <div className="text-xs text-muted-foreground">{paper.authors}</div>
                      </div>
                      <Badge variant={paper.status === 'Current' ? 'default' : 'outline'} className="text-xs">
                        {paper.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <ChartBar size={28} className="text-primary" />
                  Research Sprints
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4">
                  Month-long sprints where small teams replicate papers, run experiments, and present findings. 
                  Gain hands-on research experience.
                </p>
                <div className="space-y-4">
                  <div className="p-4 border-2 border-accent rounded-lg bg-accent/5">
                    <div className="font-semibold mb-1">Current Sprint: LoRA Implementation</div>
                    <div className="text-sm text-muted-foreground mb-2">
                      Team of 4 • Week 3 of 4 • Replicating parameter-efficient fine-tuning
                    </div>
                    <Button size="sm" variant="outline">View Progress</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-primary text-primary-foreground border-0">
            <CardContent className="p-8">
              <div className="flex items-start gap-6">
                <Atom size={48} className="flex-shrink-0" />
                <div>
                  <h3 className="text-xl font-semibold mb-2">Join a Research Sprint</h3>
                  <p className="mb-4 opacity-90">
                    No research experience required. We provide mentorship, structure, and support. 
                    Perfect for building your academic portfolio.
                  </p>
                  <Button variant="secondary">Learn More</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </section>
  )
}

function EventsSection() {
  const events = [
    {
      title: "Weekly General Meeting",
      date: "Every Friday",
      time: "5:00 PM - 6:30 PM",
      location: "Computer Science Building, Room 201",
      type: "Meeting",
      recurring: true
    },
    {
      title: "Technical Workshop: Python for AI + ML Basics",
      date: "Every Wednesday",
      time: "6:00 PM - 7:30 PM",
      location: "CS Lab",
      type: "Workshop",
      recurring: true
    },
    {
      title: "Research Reading Group",
      date: "Every Thursday",
      time: "4:00 PM - 5:00 PM",
      location: "Library Study Room B",
      type: "Research",
      recurring: true
    },
    {
      title: "Project Sprint #1 - Team Formation",
      date: "Weeks 5-6",
      time: "TBD",
      location: "CS Building",
      type: "Project"
    },
    {
      title: "Mid-Semester Mini Hackathon",
      date: "Weeks 9-10",
      time: "All Day",
      location: "CS Building",
      type: "Hackathon"
    },
    {
      title: "End of Semester Project Showcase",
      date: "Week 13",
      time: "4:00 PM - 6:00 PM",
      location: "Student Center",
      type: "Social"
    },
  ]

  return (
    <section id="events" className="py-20 md:py-28">
      <div className="max-w-7xl mx-auto px-6 md:px-8">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-6 tracking-tight">Events</h2>
          <p className="text-xl text-muted-foreground mb-12 max-w-3xl">
            Regular meetings, hands-on workshops, and research discussions. Join us throughout the semester 
            for learning, building, and collaboration.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            {events.map((event, idx) => (
              <motion.div
                key={event.title}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: idx * 0.1 }}
              >
                <Card className={`border-2 hover:shadow-lg transition-all ${event.recurring ? 'bg-primary/5 border-primary/20' : ''}`}>
                  <CardHeader>
                    <div className="flex items-center gap-3 mb-3">
                      <Badge variant={
                        event.type === 'Meeting' ? 'default' :
                        event.type === 'Workshop' ? 'secondary' :
                        event.type === 'Research' ? 'outline' :
                        event.type === 'Hackathon' ? 'destructive' :
                        'secondary'
                      }>
                        {event.type}
                      </Badge>
                      {event.recurring && (
                        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                          Recurring
                        </Badge>
                      )}
                      <Calendar size={20} className="text-muted-foreground" />
                    </div>
                    <CardTitle className="text-xl">{event.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Calendar size={16} />
                        {event.date}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-4 h-4 flex items-center justify-center">🕐</span>
                        {event.time}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-4 h-4 flex items-center justify-center">📍</span>
                        {event.location}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          <Card className="mt-12 bg-secondary/20 border-2 border-secondary">
            <CardContent className="p-8 text-center">
              <Confetti size={48} className="mx-auto mb-4 text-secondary-foreground" />
              <h3 className="text-xl font-semibold mb-2">Stay Updated</h3>
              <p className="text-muted-foreground mb-4">
                Join our Discord to get notifications about upcoming events and last-minute announcements.
              </p>
              <Button 
                className="bg-secondary text-secondary-foreground hover:bg-secondary/90"
                onClick={() => window.open('https://discord.gg/xfW4geT2P', '_blank')}
              >
                <DiscordLogo className="mr-2" />
                Join Discord
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </section>
  )
}

function ResourcesSection() {
  const resources = {
    courses: [
      { title: "CS 188: Artificial Intelligence", link: "#" },
      { title: "CS 189: Machine Learning", link: "#" },
      { title: "CS 285: Deep Reinforcement Learning", link: "#" },
    ],
    tools: [
      { title: "Richland AI GitHub Organization", link: "#" },
      { title: "Workshop Materials & Notebooks", link: "#" },
      { title: "Project Templates & Boilerplates", link: "#" },
    ],
    papers: [
      { title: "Attention Is All You Need", link: "#" },
      { title: "Deep Learning Book (Goodfellow)", link: "#" },
      { title: "Dive into Deep Learning", link: "#" },
    ]
  }

  return (
    <section id="resources" className="py-20 md:py-28 bg-card">
      <div className="max-w-7xl mx-auto px-6 md:px-8">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-6 tracking-tight">Resources</h2>
          <p className="text-xl text-muted-foreground mb-12 max-w-3xl">
            Curated learning paths, course links, tools, and papers to support your AI journey 
            from beginner to advanced researcher.
          </p>

          <div className="grid md:grid-cols-3 gap-8 mb-12">
            <Card className="border-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <GraduationCap size={24} className="text-primary" />
                  Berkeley Courses
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {resources.courses.map(course => (
                    <a
                      key={course.title}
                      href={course.link}
                      className="flex items-center justify-between p-3 bg-muted rounded-lg hover:bg-muted/80 transition-colors group"
                    >
                      <span className="text-sm font-medium">{course.title}</span>
                      <ArrowSquareOut size={16} className="text-muted-foreground group-hover:text-foreground" />
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <GithubLogo size={24} className="text-primary" />
                  Tools & Code
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {resources.tools.map(tool => (
                    <a
                      key={tool.title}
                      href={tool.link}
                      className="flex items-center justify-between p-3 bg-muted rounded-lg hover:bg-muted/80 transition-colors group"
                    >
                      <span className="text-sm font-medium">{tool.title}</span>
                      <ArrowSquareOut size={16} className="text-muted-foreground group-hover:text-foreground" />
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <BookOpen size={24} className="text-primary" />
                  Papers & Books
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {resources.papers.map(paper => (
                    <a
                      key={paper.title}
                      href={paper.link}
                      className="flex items-center justify-between p-3 bg-muted rounded-lg hover:bg-muted/80 transition-colors group"
                    >
                      <span className="text-sm font-medium">{paper.title}</span>
                      <ArrowSquareOut size={16} className="text-muted-foreground group-hover:text-foreground" />
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-2 border-accent bg-accent/5">
            <CardContent className="p-8">
              <h3 className="text-2xl font-bold mb-4">Learning Paths</h3>
              <div className="grid md:grid-cols-3 gap-6">
                <div>
                  <div className="font-semibold mb-2 flex items-center gap-2">
                    <Badge variant="outline" className="bg-green-100 text-green-800">Beginner</Badge>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                    <li>Python fundamentals</li>
                    <li>NumPy & pandas</li>
                    <li>ML basics (scikit-learn)</li>
                    <li>Neural networks intro</li>
                    <li>Work with LLM APIs</li>
                  </ol>
                </div>
                <div>
                  <div className="font-semibold mb-2 flex items-center gap-2">
                    <Badge variant="outline" className="bg-blue-100 text-blue-800">Intermediate</Badge>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                    <li>Deep learning (PyTorch)</li>
                    <li>RAG systems</li>
                    <li>AI agents & LangChain</li>
                    <li>Model deployment</li>
                    <li>Fine-tuning strategies</li>
                  </ol>
                </div>
                <div>
                  <div className="font-semibold mb-2 flex items-center gap-2">
                    <Badge variant="outline" className="bg-purple-100 text-purple-800">Advanced</Badge>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                    <li>Research methods</li>
                    <li>Paper replication</li>
                    <li>Training LLMs at scale</li>
                    <li>Novel architectures</li>
                    <li>Open source contributions</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </section>
  )
}

function JoinSection({ onSubmit }: { onSubmit: (e: React.FormEvent<HTMLFormElement>) => void }) {
  return (
    <section id="join" className="py-20 md:py-28">
      <div className="max-w-4xl mx-auto px-6 md:px-8">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-6 tracking-tight">Join Us</h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Become part of Dallas's premier AI community. All students welcome, regardless of experience level.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-8 mb-12">
          <Card className="border-2">
            <CardHeader>
              <CardTitle>Membership Benefits</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <div className="mt-1 text-primary">✓</div>
                  <span className="text-sm">Access to all workshops and learning tracks</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="mt-1 text-primary">✓</div>
                  <span className="text-sm">Join project teams and research sprints</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="mt-1 text-primary">✓</div>
                  <span className="text-sm">Exclusive access to guest speakers and mentors</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="mt-1 text-primary">✓</div>
                  <span className="text-sm">GitHub organization access and compute resources</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="mt-1 text-primary">✓</div>
                  <span className="text-sm">Community Discord with 100+ AI enthusiasts</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-2">
            <CardHeader>
              <CardTitle>Meeting Schedule</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="font-semibold mb-1">General Meetings</div>
                  <div className="text-sm text-muted-foreground">Fridays, 5:00 PM - 6:30 PM</div>
                  <div className="text-sm text-muted-foreground">Computer Science Building, Room 201</div>
                </div>
                <Separator />
                <div>
                  <div className="font-semibold mb-1">Workshops</div>
                  <div className="text-sm text-muted-foreground">Wednesdays, 6:00 PM - 7:30 PM</div>
                  <div className="text-sm text-muted-foreground">CS Lab</div>
                </div>
                <Separator />
                <div>
                  <div className="font-semibold mb-1">Research Reading Group</div>
                  <div className="text-sm text-muted-foreground">Thursdays, 4:00 PM - 5:00 PM</div>
                  <div className="text-sm text-muted-foreground">Library Study Room B</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-2 shadow-xl">
          <CardHeader>
            <CardTitle>Interest Form</CardTitle>
            <CardDescription>Fill out this form to join our community and get started!</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-6">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input id="firstName" name="firstName" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input id="lastName" name="lastName" required />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="year">Year</Label>
                <Input id="year" name="year" placeholder="e.g., Sophomore, Junior" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="experience">Experience Level</Label>
                <Input id="experience" name="experience" placeholder="e.g., Beginner, some Python experience" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="interests">What interests you most about AI?</Label>
                <Textarea 
                  id="interests" 
                  name="interests" 
                  rows={4}
                  placeholder="Tell us about your interests in AI, what you hope to learn, or projects you'd like to work on..."
                />
              </div>

              <Button type="submit" size="lg" className="w-full text-lg">
                Submit & Join Discord
                <ArrowRight className="ml-2" />
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="mt-8 text-center">
          <Button 
            variant="outline" 
            size="lg" 
            className="gap-2"
            onClick={() => window.open('https://discord.gg/xfW4geT2P', '_blank')}
          >
            <DiscordLogo size={24} />
            Or Join Discord Directly
          </Button>
        </div>
      </div>
    </section>
  )
}

function Footer({ scrollToSection }: { scrollToSection: (section: NavSection) => void }) {
  return (
    <footer className="bg-card border-t border-border py-12">
      <div className="max-w-7xl mx-auto px-6 md:px-8">
        <div className="grid md:grid-cols-4 gap-8 mb-8">
          <div>
            <h3 className="font-bold text-lg mb-4">Dallas AI Club</h3>
            <p className="text-sm text-muted-foreground">
              Build, Learn, Research.
            </p>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Quick Links</h4>
            <div className="space-y-2">
              <button onClick={() => scrollToSection('about')} className="block text-sm text-muted-foreground hover:text-foreground">
                About
              </button>
              <button onClick={() => scrollToSection('projects')} className="block text-sm text-muted-foreground hover:text-foreground">
                Projects
              </button>
              <button onClick={() => scrollToSection('workshops')} className="block text-sm text-muted-foreground hover:text-foreground">
                Workshops
              </button>
              <button onClick={() => scrollToSection('join')} className="block text-sm text-muted-foreground hover:text-foreground">
                Join
              </button>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Resources</h4>
            <div className="space-y-2">
              <a href="https://github.com/dbracewell/dallasai" target="_blank" rel="noopener noreferrer" className="block text-sm text-muted-foreground hover:text-foreground">
                GitHub
              </a>
              <a href="https://dallasai.club" target="_blank" rel="noopener noreferrer" className="block text-sm text-muted-foreground hover:text-foreground">
                Website
              </a>
              <a href="https://discord.gg/xfW4geT2P" target="_blank" rel="noopener noreferrer" className="block text-sm text-muted-foreground hover:text-foreground">
                Discord
              </a>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Connect</h4>
            <div className="flex gap-4">
              <a href="https://discord.gg/xfW4geT2P" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                <DiscordLogo size={24} />
              </a>
              <a href="https://github.com/dbracewell/dallasai" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                <GithubLogo size={24} />
              </a>
            </div>
          </div>
        </div>

        <Separator className="mb-8" />

        <div className="text-center text-sm text-muted-foreground">
          <p>© 2024 Dallas AI Club. Student-run, student-led.</p>
        </div>
      </div>
    </footer>
  )
}

export default App
