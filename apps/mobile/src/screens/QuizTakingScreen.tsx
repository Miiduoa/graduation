import React from 'react';
import QuizCenterAiFirstScreen from './QuizCenterAiFirstScreen';

// Existing links resolve to the course notice until a server-backed attempt service is available.
export function QuizTakingScreen(props: React.ComponentProps<typeof QuizCenterAiFirstScreen>) {
  return <QuizCenterAiFirstScreen {...props} />;
}
