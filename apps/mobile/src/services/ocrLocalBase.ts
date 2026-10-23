import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { TimetableOcrError } from './timetableOcr';

const files: Array<{ module: number; path: string[] }> = [
  { module: require('../../assets/ocr/tesseract.min.bin'), path: ['tesseract.min.js'] },
  { module: require('../../assets/ocr/worker.min.bin'), path: ['worker.min.js'] },
  {
    module: require('../../assets/ocr/tesseract-core-simd-lstm.wasm.js.bin'),
    path: ['tesseract-core-simd-lstm.wasm.js'],
  },
  {
    module: require('../../assets/ocr/lang/chi_tra.traineddata.gz'),
    path: ['lang', 'chi_tra.traineddata.gz'],
  },
  { module: require('../../assets/ocr/lang/eng.traineddata.gz'), path: ['lang', 'eng.traineddata.gz'] },
];

let prepared: Promise<string> | null = null;

export function prepareOcrBaseUrl(): Promise<string> {
  if (!prepared) {
    prepared = copyOcrFiles().catch((error) => {
      prepared = null;
      throw error;
    });
  }
  return prepared;
}

async function copyOcrFiles(): Promise<string> {
  const root = new Directory(Paths.cache, 'personal-import-ocr');
  root.create({ idempotent: true, intermediates: true });
  new Directory(root, 'lang').create({ idempotent: true, intermediates: true });
  for (const file of files) {
    const asset = Asset.fromModule(file.module);
    await asset.downloadAsync();
    if (!asset.localUri)
      throw new TimetableOcrError('辨識程式未能載入，請改貼文字。', 'unavailable');
    const dest = new File(root, ...file.path);
    if (dest.exists) continue;
    new File(asset.localUri).copy(dest);
  }
  const uri = root.uri;
  return uri.endsWith('/') ? uri : `${uri}/`;
}
