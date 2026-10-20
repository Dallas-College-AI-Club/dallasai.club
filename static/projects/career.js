export function careerMarkup() {
  return /* HTML */ `<section class="career-project" aria-labelledby="career-title">
    <div class="career-copy">
      <span class="tag">02 / WORK IN PROGRESS</span>
      <h2 id="career-title" tabindex="-1">Career & Venture Builder</h2>
      <p><em>Connecting campus resources to real-world success.</em></p>
      <p>
        A secure, private platform that unifies existing resources to bridge the gaps of traditional third-party platforms, focusing entirely on genuine, value-add support.
      </p>
      <ul>
        <li>Receive customized support based on your individual unique strengths and drive.</li>
        <li>Align your goals to the latest, rapidly changing industry needs and trends.</li>
        <li>Translate academic learning directly into career readiness or venture creation.</li>
      </ul>
      <span class="career-note">The preview features are subject to change as we iterate based on student needs and advisor feedback.</span>
    </div>
    <div class="career-workspace">
      <div class="career-vision" aria-hidden="true">
        <div class="career-vision-heading">
          <span>CAREER STUDIO</span><strong>Make your<br /><em>next move.</em></strong>
        </div>
        <div class="career-orbit">
          <div class="career-paper"><i></i><i></i><i></i><i></i><span>YOUR EXPERIENCE</span></div>
          <div class="career-target"><span>↗</span><i></i><i></i></div>
          <svg viewBox="0 0 320 190"><path d="M60 132C125 155 131 25 254 71" /></svg
          ><span class="career-orbit-star">✦</span>
        </div>
        <div class="career-vision-path">
          <span>Find the connection</span><b>→</b><span>Tell your story</span><b>→</b
          ><span>Be ready</span>
        </div>
      </div>
      <div class="career-appbar">
        <span class="career-symbol" aria-hidden="true">↗</span><strong>Career studio</strong
        ><span>Concept preview</span>
      </div>
      <div class="career-tabs" aria-label="Career builder preview">
        <button data-career="resume" aria-pressed="true">Resume match</button
        ><button data-career="interview" aria-pressed="false">Interview prep</button>
      </div>
      <div class="career-role">
        <span>TARGET ROLE</span><strong>Project Coordinator</strong>
        <p>Manage project timelines · Coordinate team communication · Track deliverables</p>
      </div>
      <div id="career-example" class="career-example"></div>
      <p class="career-disclaimer">
         
      </p>
    </div>
  </section>`;
}
export function mountCareer(root) {
  let tailored = false;
  const panel = root.querySelector('#career-example');
  const draw = (mode) => {
    root
      .querySelectorAll('[data-career]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.career === mode)));
    panel.innerHTML =
      mode === 'resume'
        ? /* HTML */ `<span class="career-label"
            >${tailored ? 'REFINED FOR THIS ROLE' : 'A STUDENT’S EXPERIENCE'}</span
          >
          <blockquote>
            ${tailored ? 'Coordinated a 5-person academic project team, developing a shared tracking system to manage deliverables and deadlines.' : 'I organized our final group project and made a shared spreadsheet so everyone knew what to do.'}
          </blockquote>
          <div class="career-matches">
            <span>✓ Team Coordination</span><span>✓ Task Management</span><span>✓ Communication</span>
          </div>
          <button id="career-tailor">
            ${tailored ? 'See original wording ↶' : 'See a tailored example ↗'}
          </button>
          <p class="career-evidence">
            ${tailored ? 'Same experience, clearer professional connection. No invented outcomes.' : 'Start with what you actually did. Make the connection easy to see.'}
          </p>`
        : /* HTML */ `<span class="career-label">PRACTICE WITH YOUR OWN EVIDENCE</span>
          <h3>“Tell me about a time you had to manage multiple priorities to meet a deadline.”</h3>
          <ol>
            <li><strong>Situation:</strong> Describe an academic or club project with a tight deadline.</li>
            <li>
              <strong>Action:</strong> Explain how you prioritized tasks and communicated with your team.
            </li>
            <li><strong>Result:</strong> Share the final outcome and what you learned about project management.</li>
          </ol>
          <p class="career-evidence">
            Use a real example. If you missed a deadline or faced a roadblock, explain how you adjusted and communicated the delay.
          </p>`;
    const button = panel.querySelector('#career-tailor');
    if (button)
      button.onclick = () => {
        tailored = !tailored;
        draw('resume');
        panel.querySelector('#career-tailor').focus({ preventScroll: true });
      };
  };
  root.querySelectorAll('[data-career]').forEach((b) => (b.onclick = () => draw(b.dataset.career)));
  draw('resume');
  return () => {};
}
