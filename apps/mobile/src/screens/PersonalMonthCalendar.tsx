import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { buildMonthCalendar, MONTH_WEEKDAYS, type PersonalImportRecord } from '@campus/shared';
import { theme } from '../ui/theme';

export function PersonalMonthCalendar({
  records,
  month,
  selectedDate,
  onDate,
  onEdit,
  disabled,
}: {
  records: readonly PersonalImportRecord[];
  month: string;
  selectedDate: string;
  onDate: (date: string) => void;
  onEdit: (event: PersonalImportRecord) => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const cells = buildMonthCalendar(records, month);
  return (
    <View accessibilityLabel={`${month} 月格，週日起始`}>
      <View style={{ flexDirection: 'row' }}>
        {MONTH_WEEKDAYS.map((day) => (
          <Text
            key={day}
            style={{ flex: 1, textAlign: 'center', color: theme.colors.muted, paddingVertical: 8 }}
          >
            週{day}
          </Text>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, week) => (
        <View key={week} style={{ flexDirection: 'row', alignItems: 'stretch' }}>
          {cells.slice(week * 7, week * 7 + 7).map((day, index) => (
            <View
              key={day?.date || `blank-${index}`}
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 124,
                borderTopWidth: 1,
                borderRightWidth: 1,
                borderColor: theme.colors.border,
                padding: 2,
              }}
            >
              {day ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={day.date}
                    accessibilityState={{ selected: day.date === selectedDate }}
                    onPress={() => onDate(day.date)}
                    style={{
                      minHeight: 44,
                      justifyContent: 'center',
                      backgroundColor: selectedDate === day.date ? theme.colors.surface : undefined,
                    }}
                  >
                    <Text style={{ color: theme.colors.text }}>{Number(day.date.slice(-2))}</Text>
                  </Pressable>
                  {(expanded.includes(day.date) ? day.events : day.events.slice(0, 2)).map(
                    (event) => (
                      <Pressable
                        key={event.id}
                        accessibilityRole="button"
                        accessibilityLabel={event.title}
                        disabled={disabled}
                        onPress={() => onEdit(event)}
                        style={{
                          minHeight: 44,
                          borderLeftWidth: 2,
                          borderColor: theme.colors.accent,
                          marginBottom: 4,
                          paddingLeft: 2,
                        }}
                      >
                        <Text style={{ color: theme.colors.text, fontSize: 12, lineHeight: 17 }}>
                          {event.title}
                        </Text>
                      </Pressable>
                    ),
                  )}
                  {day.events.length > 2 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: expanded.includes(day.date) }}
                      onPress={() =>
                        setExpanded((prev) =>
                          prev.includes(day.date)
                            ? prev.filter((date) => date !== day.date)
                            : [...prev, day.date],
                        )
                      }
                      style={{ minHeight: 44 }}
                    >
                      <Text style={{ color: theme.colors.accent, fontSize: 12 }}>
                        {expanded.includes(day.date) ? '收合' : `還有 ${day.events.length - 2} 筆`}
                      </Text>
                    </Pressable>
                  ) : null}
                </>
              ) : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
