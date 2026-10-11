import { File } from 'expo-file-system';

export class TimetableOcrError extends Error {
  constructor(
    message: string,
    readonly kind: 'unavailable' | 'empty' | 'network' = 'unavailable',
  ) {
    super(message);
  }
}

export async function readImageBase64(uri: string): Promise<string> {
  const file = new File(uri);
  return file.base64();
}

export const TIMETABLE_OCR_HTML = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script>
    <script>
      function send(payload) {
        if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
      async function recognize(base64) {
        try {
          if (!window.Tesseract) throw new Error('missing');
          const result = await window.Tesseract.recognize('data:image/jpeg;base64,' + base64, 'chi_tra+eng');
          send({ ok: true, text: (result && result.data && result.data.text) || '' });
        } catch (error) {
          send({ ok: false, error: String(error && error.message ? error.message : error) });
        }
      }
      window.recognizeTimetable = recognize;
      send({ ready: true });
    </script>
  </body>
</html>`;
