import { ASSISTANT_EXPERIENCES } from '@campus/shared/src/assistantExperiences';
import { resolveAssistantServiceIntent } from '@campus/shared/src/assistantServices';
import { parseAssistantWorkSessionIntent } from '@campus/shared/src/assistantWorkSessionIntent';
import { mobileWorkspaceExperience, mobileWorkspaceSuggestions, workspaceContextForRole } from '../../services/workspaceEntry';

test('native discovery uses real service commands for public and unsupported professional readers', () => {
  for (const source of ASSISTANT_EXPERIENCES.filter((experience) => experience.workContext !== 'student' && experience.id !== 'library')) {
    for (const platform of [true, false]) {
      const experience = mobileWorkspaceExperience(source, platform);
      const service = resolveAssistantServiceIntent(experience.prompt);
      const workSession = platform ? parseAssistantWorkSessionIntent(experience.prompt) : null;
      expect({ id: source.id, supported: !!service || !!workSession }).toEqual({ id: source.id, supported: true });
    }
  }
  expect(resolveAssistantServiceIntent(mobileWorkspaceSuggestions('student', true)[2])?.kind).toBe('catalog');
});

test('school administration examples cannot select the platform operator context by account role', () => {
  expect(workspaceContextForRole('admin')).toBe('staff');
  expect(workspaceContextForRole('department')).toBe('staff');
});
