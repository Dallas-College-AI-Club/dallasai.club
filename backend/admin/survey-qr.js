import qrcode from 'qrcode-generator';
import { button, node } from './ui.js';
import { fileSlug } from '../surveys/results-ui.js';

export function surveyQR(survey) {
  return button('QR code', () => {
    const qr = qrcode(0, 'M');
    qr.addData(survey.privateLink);
    qr.make();
    const dialog = node('dialog', undefined, 'survey-qr');
    const title = node('h2', survey.title);
    title.id = 'survey-qr-title';
    dialog.setAttribute('aria-labelledby', title.id);
    const graphic = node('div');
    graphic.innerHTML = qr.createSvgTag({
      cellSize: 5,
      margin: 20,
      scalable: true,
    });
    graphic.setAttribute('role', 'img');
    graphic.setAttribute('aria-label', 'QR code for ' + survey.title);
    const download = node('a', 'Download QR', 'button-link');
    const url = URL.createObjectURL(
      new Blob([qr.createSvgTag(8, 32)], { type: 'image/svg+xml' }),
    );
    download.href = url;
    download.download = fileSlug(survey.title) + '-qr.svg';
    dialog.append(
      title,
      graphic,
      node('p', 'Scan to answer this survey. Email verification is required.'),
      download,
      button('Close QR', () => dialog.close()),
    );
    dialog.onclose = () => {
      URL.revokeObjectURL(url);
      dialog.remove();
    };
    document.body.append(dialog);
    dialog.showModal();
  });
}
