export function careerMarkup() {
  return /* HTML */ `<section class="career-project" aria-labelledby="career-title">
    <div class="career-copy">
      <span class="tag">02 / WORK IN PROGRESS</span>
      <h2 id="career-title" tabindex="-1">Career Resume Builder</h2>
      <p>Your experience. The right words.</p>
      <p>
        A tool in development to help students tailor their resumes to a job description and prepare
        for an interview.
      </p>
      <ul>
        <li>Connect real experience to job requirements.</li>
        <li>Refine a resume without inventing qualifications.</li>
        <li>Practice questions relevant to the role.</li>
      </ul>
      <span class="career-note">Preview the idea with a fictional student example.</span>
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
        <span>TARGET ROLE</span><strong>Student IT support assistant</strong>
        <p>Explain technical steps clearly · Troubleshoot problems · Keep accurate records</p>
      </div>
      <div id="career-example" class="career-example"></div>
      <p class="career-disclaimer">
        Illustrative examples. The resume-building tool is still in development.
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
              ${tailored ? 'Helped classmates set up laptops and documented common setup problems in a checklist.' : 'I helped classmates set up their laptops and made a checklist of common problems.'}
            </blockquote>
            <div class="career-matches">
              <span>✓ Communication</span><span>✓ Troubleshooting</span><span>✓ Documentation</span>
            </div>
            <button id="career-tailor">
              ${tailored ? 'See original wording ↶' : 'See a tailored example ↗'}
            </button>
            <p class="career-evidence">
              ${tailored ? 'Same experience, clearer connection. No new skills or outcomes added.' : 'Start with what you actually did. Make the connection easy to see.'}
            </p>`
        : /* HTML */ `<span class="career-label">PRACTICE WITH YOUR OWN EVIDENCE</span>
            <h3>“How would you help someone who is frustrated with a technical problem?”</h3>
            <ol>
              <li><strong>Situation:</strong> Describe a classmate’s setup problem.</li>
              <li>
                <strong>Action:</strong> Explain how you listened and worked through it step by
                step.
              </li>
              <li><strong>Result:</strong> Say what happened and what you learned.</li>
            </ol>
            <p class="career-evidence">
              Use a real example. If you could not resolve the problem, explain how you asked for
              help.
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
