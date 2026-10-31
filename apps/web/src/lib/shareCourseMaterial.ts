export async function shareCourseMaterial(title: string, path: string): Promise<string> {
  const url = new URL(path, window.location.origin).href;
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return '已開啟分享。對方仍需登入並有這門課的權限。';
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === 'AbortError') return '';
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      return '教材連結已複製。對方仍需登入並有這門課的權限。';
    } catch { /* Use a local link file when clipboard access is unavailable. */ }
  }
  const blob = new Blob([url], { type: 'text/plain;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = '教材連結.txt';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
  return '已另存教材連結，開啟時仍會確認課程權限。';
}
