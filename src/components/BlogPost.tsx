import { motion } from 'framer-motion'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar, Clock, GithubLogo, DiscordLogo, Newspaper, TShirt, InstagramLogo, Users, CheckCircle, Confetti, Trophy, MapPin } from '@phosphor-icons/react'
import { Separator } from '@/components/ui/separator'

export function BlogPost() {
  return (
    <section id="blog" className="py-20 md:py-28">
      <div className="max-w-5xl mx-auto px-6 md:px-8">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <div className="mb-8">
            <Badge variant="outline" className="mb-4 text-sm">Latest Update</Badge>
            <h1 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight" style={{ letterSpacing: '-0.01em' }}>
              We're Official! Dallas AI Club Approved as RSO
            </h1>
            <div className="flex flex-wrap items-center gap-4 text-muted-foreground">
              <div className="flex items-center gap-2">
                <Calendar size={18} />
                <span className="text-sm">April 2026</span>
              </div>
              <div className="flex items-center gap-2">
                <Users size={18} />
                <span className="text-sm">Club Leadership</span>
              </div>
            </div>
          </div>

          <Separator className="my-8" />

          <div className="prose prose-lg max-w-none space-y-8">
            <Card className="bg-primary/10 border-2 border-primary">
              <CardContent className="p-6 flex items-start gap-4">
                <Confetti size={48} className="text-primary flex-shrink-0" weight="fill" />
                <div>
                  <p className="text-lg font-semibold mb-2">
                    Exciting News from Dallas AI Club!
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    We're thrilled to announce that the Dallas AI Club (formerly Richland AI Club) has been 
                    officially approved as a Recognized Student Organization (RSO) at Dallas College! This is 
                    a major milestone in our journey to build a vibrant AI community.
                  </p>
                </div>
              </CardContent>
            </Card>

            <div>
              <h2 className="text-3xl font-bold mb-4 flex items-center gap-3">
                <Trophy className="text-primary" size={32} />
                Meet Your Inaugural Officers
              </h2>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                To ensure fairness and inclusivity in our inaugural leadership selection, we created a script 
                that randomly selected individuals who expressed interest in serving as officers. We're excited 
                to introduce the team that will guide our club through its first chapter:
              </p>
              
              <div className="grid md:grid-cols-2 gap-6">
                <Card className="border-2 hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-bold">
                        PN
                      </div>
                      <div>
                        <CardTitle className="text-xl">Phuong Nguyen</CardTitle>
                        <CardDescription>President</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Leading our club's vision and strategic direction
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-2 hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-bold">
                        SB
                      </div>
                      <div>
                        <CardTitle className="text-xl">Shirley Bracewell</CardTitle>
                        <CardDescription>Secretary</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Managing documentation and communications
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-2 hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-bold">
                        MH
                      </div>
                      <div>
                        <CardTitle className="text-xl">Matthew Haling Htang</CardTitle>
                        <CardDescription>SGA Representative</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Liaison to Student Government Association
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-2 hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-bold">
                        TM
                      </div>
                      <div>
                        <CardTitle className="text-xl">Trinh Thi Diem My</CardTitle>
                        <CardDescription>Treasurer</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Managing finances and SGA funding coordination
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>

            <div>
              <h2 className="text-3xl font-bold mb-4">What This Means for Our Club</h2>
              <Card className="border-2">
                <CardContent className="p-6">
                  <ul className="space-y-4">
                    <li className="flex items-start gap-3">
                      <CheckCircle size={24} className="text-primary flex-shrink-0 mt-0.5" weight="fill" />
                      <div>
                        <span className="font-semibold">Official Recognition:</span>
                        <p className="text-sm text-muted-foreground mt-1">
                          As an RSO, we have formal standing with Dallas College and can access campus resources
                        </p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckCircle size={24} className="text-primary flex-shrink-0 mt-0.5" weight="fill" />
                      <div>
                        <span className="font-semibold">Funding Access:</span>
                        <p className="text-sm text-muted-foreground mt-1">
                          Our treasurer can now work with SGA to secure budget for workshops, events, and resources
                        </p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckCircle size={24} className="text-primary flex-shrink-0 mt-0.5" weight="fill" />
                      <div>
                        <span className="font-semibold">Campus Presence:</span>
                        <p className="text-sm text-muted-foreground mt-1">
                          We can officially advertise, book spaces, and participate in campus-wide events
                        </p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckCircle size={24} className="text-primary flex-shrink-0 mt-0.5" weight="fill" />
                      <div>
                        <span className="font-semibold">Leadership Structure:</span>
                        <p className="text-sm text-muted-foreground mt-1">
                          Our inaugural officer team can now officially coordinate club activities and represent members
                        </p>
                      </div>
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </div>

            <div>
              <h2 className="text-3xl font-bold mb-4">Next Steps</h2>
              <div className="grid md:grid-cols-2 gap-6">
                <Card className="border-2 border-accent bg-accent/5">
                  <CardHeader>
                    <CardTitle className="text-xl">For Members</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li className="flex items-start gap-2">
                        <span className="text-primary font-bold">•</span>
                        <span>Join our Discord to stay connected</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary font-bold">•</span>
                        <span>Attend upcoming meetings (schedule TBD)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary font-bold">•</span>
                        <span>Share project ideas and interests</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary font-bold">•</span>
                        <span>Follow updates on dallasai.club</span>
                      </li>
                    </ul>
                  </CardContent>
                </Card>

                <Card className="border-2 border-secondary bg-secondary/5">
                  <CardHeader>
                    <CardTitle className="text-xl">For Officers</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li className="flex items-start gap-2">
                        <span className="text-primary font-bold">•</span>
                        <span>Complete SGA budget form and funding requests</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary font-bold">•</span>
                        <span>Finalize meeting schedule and locations</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary font-bold">•</span>
                        <span>Plan first semester's workshops and events</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-primary font-bold">•</span>
                        <span>Coordinate with SGA and campus departments</span>
                      </li>
                    </ul>
                  </CardContent>
                </Card>
              </div>
            </div>

            <Card className="border-2 border-accent bg-accent/10">
              <CardContent className="p-8 text-center">
                <h3 className="text-2xl font-bold mb-4">Join the Movement</h3>
                <p className="text-muted-foreground mb-6 max-w-2xl mx-auto">
                  This is just the beginning! Whether you're new to AI or already experienced, there's a place 
                  for you in our community. Connect with us and help shape the future of AI at Dallas College.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <Button 
                    size="lg"
                    className="gap-2"
                    onClick={() => window.open('https://discord.gg/xfW4geT2P', '_blank')}
                  >
                    <DiscordLogo size={24} />
                    Join Our Discord
                  </Button>
                  <Button 
                    size="lg"
                    variant="outline"
                    className="gap-2"
                    onClick={() => window.open('https://github.com/dbracewell/dallasai', '_blank')}
                  >
                    <GithubLogo size={24} />
                    View on GitHub
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="mt-12 pt-8 border-t border-border">
              <p className="text-sm text-muted-foreground text-center">
                Posted by Dallas AI Club Leadership • April 2026
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
