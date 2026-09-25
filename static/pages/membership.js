import { JOIN_URL } from '../content/club.js';
import { formFooter, identityFields, mountForm } from '../app/form-client.js';
export function renderMembership(root) {
  root.innerHTML = `<header class="space-masthead"><h1>Join the club</h1></header><div class="club-form-layout"><section><h2>Find your people. Build something together.</h2><p>Tell us a little about yourself. All experience levels are welcome.</p><form class="club-form" id="membership-form">${identityFields()}
    <label>Campus<select name="campus" required><option value="">Choose your campus</option>${['Brookhaven', 'Cedar Valley', 'Eastfield', 'El Centro', 'Mountain View', 'North Lake', 'Richland', 'Other / community'].map((x) => `<option>${x}</option>`).join('')}</select></label>
    <label>What would you like to explore? <span>(optional)</span><textarea name="interests" rows="4" maxlength="1500" placeholder="Projects, workshops, questions, or ideas…"></textarea></label>
    ${formFooter('Join the club', 'I would like to join the Dallas College AI Club and receive messages about my membership.')}</form></section>
    <aside><h2>Continue the conversation</h2><p>Our community meets in Microsoft Teams. You can join the conversation while we process your registration.</p><a class="outline-link" href="${JOIN_URL}" target="_blank" rel="noreferrer">Open Teams ↗</a><p>Want new articles by email? <a href="club.html?mode=subscribe">Subscribe to The AI Review</a>.</p></aside></div>`;
  return mountForm(root.querySelector('form'), { kind: 'join' });
}
