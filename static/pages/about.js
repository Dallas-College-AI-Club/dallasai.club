import { ADVISORS } from '../content/club.js';

const fields = [
  'Arts',
  'Business',
  'Education',
  'Health',
  'Science',
  'Technology',
  'Humanities',
  'Community',
];
export function aboutMarkup() {
  return /* HTML */ `<header class="space-masthead about-masthead">
      <div class="space-title-row">
        <h1>About the club</h1>
        <span>Different perspectives. Shared possibilities.</span>
      </div>
    </header>
    <section class="vision-intro" aria-labelledby="vision-heading">
      <h2 id="vision-heading">
        AI is a universal tool. Access to its benefits should be <em>universal,</em> too.
      </h2>
      <p>
        Our vision is to empower every Dallas College student with the knowledge, skills, and
        ethical foundation to thrive and lead in a world shaped by AI. Students of every major,
        background, and income level belong here.
      </p>
      <p>
        We explore machine learning, data science, and AI development through workshops and student
        projects.
      </p>
    </section>
    <div class="discipline-ribbon" aria-label="An interdisciplinary community">
      <p class="visually-hidden">${fields.join(', ')}. Every field belongs here.</p>
      <div class="discipline-window" aria-hidden="true">
        <div class="discipline-track">
          ${[0, 1].map(() => /* HTML */ `<span>${fields.map((f) => /* HTML */ `<b>${f}</b>`).join('')}</span>`).join('')}
        </div>
      </div>
    </div>
    <section class="vision-pillars" aria-labelledby="pillars-heading">
      <h2 id="pillars-heading" class="section-eyebrow">Our core pillars</h2>
      <article class="vision-pillar">
        <span class="pillar-number" aria-hidden="true">01</span>
        <div>
          <h3>Technology for everyone</h3>
          <p>
            Artists, nurses, educators, entrepreneurs, and computer scientists all have a place
            here. We work to remove academic and socioeconomic barriers so every student can build
            useful skills and put AI to work in their field.
          </p>
        </div>
      </article>
      <article class="vision-pillar">
        <span class="pillar-number" aria-hidden="true">02</span>
        <div>
          <h3>Practical skills for work and life</h3>
          <p>Try practical activities that connect your interests with useful skills.</p>
          <dl class="learning-paths">
            <div>
              <dt>Use AI in your field</dt>
              <dd>
                Explore how AI can help you plan, solve problems and improve everyday workflows.
              </dd>
            </div>
            <div>
              <dt>Build with AI</dt>
              <dd>
                Explore coding agents and build applications that help people with real tasks.
              </dd>
            </div>
            <div>
              <dt>Test a business idea</dt>
              <dd>Turn an idea into a small prototype and test it with potential users.</dd>
            </div>
            <div>
              <dt>Think and work together</dt>
              <dd>
                Practice clear reasoning, discuss different perspectives and collaborate across
                fields.
              </dd>
            </div>
          </dl>
        </div>
      </article>
      <article class="vision-pillar">
        <span class="pillar-number" aria-hidden="true">03</span>
        <div>
          <h3>Critical AI literacy</h3>
          <p>
            Learn to ask better questions, design effective prompts and systems, and evaluate the
            answers. Practice checking facts, spotting invented information, and recognizing a
            tool’s limits. Human judgment stays at the center.
          </p>
        </div>
      </article>
      <article class="vision-pillar">
        <span class="pillar-number" aria-hidden="true">04</span>
        <div>
          <h3>Ethics and bias</h3>
          <p>
            Explore how bias enters data and algorithms and who is affected by the results. We
            encourage fair, transparent, and responsible choices that serve communities.
          </p>
        </div>
      </article>
      <article class="vision-pillar">
        <span class="pillar-number" aria-hidden="true">05</span>
        <div>
          <h3>Data governance and security</h3>
          <p>
            Understand how to protect personal and sensitive information. Learn the foundations of
            privacy, security, and responsible data governance. Put these principles into practice
            when choosing tools and managing how information is used and shared.
          </p>
        </div>
      </article>
    </section>
    <section class="vision-advisors" aria-labelledby="advisors-heading">
      <h2 id="advisors-heading" class="section-eyebrow">Co-advisors</h2>
      <div class="advisor-grid">
        ${ADVISORS.map(
          (advisor) =>
            /* HTML */ `<article>
              <h3>${advisor.name}</h3>
              <p>${advisor.role}</p>
              <small>Dallas College</small>
              <div class="advisor-links">
                <a href="mailto:${advisor.email}">Email ${advisor.firstName} ↗</a
                ><a href="${advisor.linkedin}" target="_blank" rel="noreferrer">LinkedIn ↗</a>
              </div>
            </article>`,
        ).join('')}
      </div>
    </section> `;
}
export function mountAbout(root) {
  root
    .querySelector('.discipline-ribbon')
    .classList.toggle(
      'is-paused',
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
        document.body.classList.contains('reduced'),
    );
}
