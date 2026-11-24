import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { getAssistantLibraryCatalog } from '@campus/shared/src/assistantLibraryCatalog';
import { AIButton, aiTokens } from '../ui/aiFirst';

const alwaysCurrent = () => true;

/**
 * Official library destinations for the selected school. The parent message already
 * shows the library name and scope, so this renders only the explicit open actions.
 * Only the school id is read from props; every URL comes from the trusted directory,
 * never from message text or a caller-supplied link.
 */
export function OfficialLibraryReply({ directory, disabled = false, isCurrent = alwaysCurrent }: {
  directory: { schoolId: string };
  disabled?: boolean;
  isCurrent?: () => boolean;
}) {
  const { schoolId } = directory;
  const catalog = useMemo(() => getAssistantLibraryCatalog(schoolId), [schoolId]);
  const [linkError, setLinkError] = useState(false);
  const opening = useRef(false);
  // Bumped whenever the bound school changes or the component unmounts, so a
  // late rejection from an earlier launch can never write state.
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    opening.current = false;
    setLinkError(false);
    return () => {
      generation.current += 1;
      opening.current = false;
    };
  }, [schoolId]);

  if (!catalog) return null;

  const open = async (url: string) => {
    if (disabled || opening.current || !isCurrent()) return;
    const token = generation.current;
    const live = () => token === generation.current && isCurrent();
    opening.current = true;
    setLinkError(false);
    try {
      await Linking.openURL(url);
    } catch {
      if (live()) setLinkError(true);
    } finally {
      if (token === generation.current) opening.current = false;
    }
  };

  const { catalogUrl, hoursUrl } = catalog;
  return <View style={{ gap: 12 }}>
    <AIButton label="開啟官方館藏查詢" disabled={disabled} onPress={() => { void open(catalogUrl); }} />
    {hoursUrl && <AIButton label="查看開館時間頁面" variant="ghost" disabled={disabled}
      onPress={() => { void open(hoursUrl); }} />}
    {hoursUrl && <Text style={{ color: aiTokens.textSecondary, fontSize: 13, lineHeight: 21 }}>
      開館時間以校方公開頁面為準。
    </Text>}
    {linkError && <Text accessibilityRole="alert"
      style={{ color: aiTokens.textSecondary, fontSize: 13, lineHeight: 21 }}>
      無法開啟校方網站，請稍後再試。
    </Text>}
  </View>;
}
