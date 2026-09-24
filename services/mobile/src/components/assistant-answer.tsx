import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** Render the small Markdown subset Sparky uses without exposing markup to customers. */
export function AssistantAnswer({ text, color }: { text: string; color: string }) {
  const paragraphs = text.trim().split(/\n\s*\n/).filter(Boolean);
  return <View style={styles.answer}>
    {paragraphs.map((paragraph, index) => {
      const lines = paragraph.split('\n');
      return <View key={index} style={styles.paragraph}>
        {lines.map((line, lineIndex) => {
          const bullet = /^\s*[-*]\s+/.test(line);
          const content = line.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*[-*]\s+/, '');
          const parts = content.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
          return <Text key={lineIndex} style={[styles.line, { color }, bullet && styles.bullet]}>
            {bullet ? '• ' : null}
            {parts.map((part, partIndex) => {
              const strong = part.startsWith('**') && part.endsWith('**');
              const code = part.startsWith('`') && part.endsWith('`');
              return <Fragment key={partIndex}>{strong || code
                ? <Text style={styles.emphasis}>{part.slice(strong ? 2 : 1, strong ? -2 : -1)}</Text>
                : part}</Fragment>;
            })}
          </Text>;
        })}
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  answer: { gap: 9 },
  paragraph: { gap: 3 },
  line: { fontSize: 14, lineHeight: 21 },
  bullet: { paddingLeft: 4 },
  emphasis: { fontWeight: '700' },
});
