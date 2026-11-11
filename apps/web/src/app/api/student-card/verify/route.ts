import { studentCardRequest } from '@/lib/server/studentCard';

export const runtime = 'nodejs';

export function POST(request: Request) {
  return studentCardRequest(request, 'verify');
}
