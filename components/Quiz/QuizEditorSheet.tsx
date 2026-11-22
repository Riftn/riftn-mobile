import React, { useEffect, useState } from "react";
import { Modal, View, Text, Pressable, TextInput, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import { createQuiz, draftQuiz, isQuizDraftValid, type QuizDraft } from "../../services/quiz.service";
import { toastError } from "../../libs/toast";

const POINTS = [5, 10, 25, 50];
const MAX_QUESTIONS = 10;
const WHITE = "rgba(255,255,255,1)";
const MUTED = "rgba(255,255,255,0.55)";
const LINE = "rgba(255,255,255,0.15)";

interface Props {
  visible: boolean;
  tokenId: number;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Add a quiz to your own post: describe it in a few words, get questions
 * written, check and fix them, pick the points, save. Each reader gets one go.
 */
const QuizEditorSheet: React.FC<Props> = ({ visible, tokenId, onClose, onSaved }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<QuizDraft>({ topic: "", questions: [], pointsPerQuestion: 10 });
  const [writing, setWriting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (visible) setDraft({ topic: "", questions: [], pointsPerQuestion: 10 }); }, [visible]);

  const write = async () => {
    if (!draft.topic.trim() || writing) return;
    setWriting(true);
    try {
      const res = await draftQuiz(draft.topic.trim(), 5);
      setDraft((d) => ({ ...d, topic: res.topic || d.topic, questions: res.questions }));
    } catch (err: any) {
      toastError(err?.message || t("quiz.writeFailed"));
    } finally {
      setWriting(false);
    }
  };

  const save = async () => {
    if (!isQuizDraftValid(draft) || saving) return;
    setSaving(true);
    try {
      await createQuiz(tokenId, {
        ...draft,
        questions: draft.questions.map((q) => ({ ...q, options: q.options.map((o) => o.trim()) })),
      });
      onSaved();
      onClose();
    } catch (err: any) {
      toastError(err?.message || t("quiz.attachFailed"));
    } finally {
      setSaving(false);
    }
  };

  const setQuestion = (qi: number, patch: Partial<QuizDraft["questions"][number]>) =>
    setDraft((d) => ({ ...d, questions: d.questions.map((q, i) => (i === qi ? { ...q, ...patch } : q)) }));

  const valid = isQuizDraftValid(draft);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: "rgba(10,10,12,1)", paddingTop: insets.top, paddingBottom: insets.bottom }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, height: 52 }}>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("common.close")}>
              <Icon name="X" size={22} color={WHITE} />
            </Pressable>
            <Text style={{ color: WHITE, fontSize: 16, fontWeight: "600" }}>{t("quiz.add")}</Text>
            <Pressable onPress={save} disabled={!valid || saving} hitSlop={10} accessibilityRole="button">
              {saving ? <ActivityIndicator size="small" color={WHITE} /> : (
                <Text style={{ color: valid ? WHITE : MUTED, fontSize: 15, fontWeight: "600" }}>{t("photoTags.done")}</Text>
              )}
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12, gap: 12 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                value={draft.topic}
                onChangeText={(topic) => setDraft((d) => ({ ...d, topic }))}
                placeholder={t("quiz.topicPlaceholder")}
                placeholderTextColor={MUTED}
                maxLength={120}
                style={{ flex: 1, color: WHITE, fontSize: 15, borderWidth: 1, borderColor: LINE, borderRadius: 10, paddingHorizontal: 12, height: 44 }}
              />
              <Pressable onPress={write} disabled={!draft.topic.trim() || writing} accessibilityRole="button">
                <View style={{ height: 44, borderRadius: 10, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)", opacity: draft.topic.trim() ? 1 : 0.5 }}>
                  {writing ? <ActivityIndicator size="small" color={WHITE} /> : (
                    <Text style={{ color: WHITE, fontSize: 14, fontWeight: "600" }}>{draft.questions.length ? t("quiz.rewrite") : t("quiz.write")}</Text>
                  )}
                </View>
              </Pressable>
            </View>
            <Text style={{ color: MUTED, fontSize: 12 }}>{t("quiz.editorHint")}</Text>

            {draft.questions.map((q, qi) => (
              <View key={qi} style={{ gap: 6, borderWidth: 1, borderColor: LINE, borderRadius: 12, padding: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <TextInput
                    value={q.q}
                    onChangeText={(text) => setQuestion(qi, { q: text })}
                    placeholder={t("quiz.questionPlaceholder")}
                    placeholderTextColor={MUTED}
                    multiline
                    maxLength={200}
                    style={{ flex: 1, color: WHITE, fontSize: 15 }}
                  />
                  <Pressable
                    onPress={() => setDraft((d) => ({ ...d, questions: d.questions.filter((_, i) => i !== qi) }))}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={t("quiz.removeQuestion")}
                  >
                    <Icon name="Trash2" size={16} color={MUTED} />
                  </Pressable>
                </View>
                {q.options.map((option, oi) => (
                  <View key={oi} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Pressable onPress={() => setQuestion(qi, { answer: oi })} hitSlop={8} accessibilityRole="radio" accessibilityState={{ checked: q.answer === oi }} accessibilityLabel={t("quiz.markRight")}>
                      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: q.answer === oi ? WHITE : MUTED, alignItems: "center", justifyContent: "center" }}>
                        {q.answer === oi && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: WHITE }} />}
                      </View>
                    </Pressable>
                    <TextInput
                      value={option}
                      onChangeText={(text) => setQuestion(qi, { options: q.options.map((o, i) => (i === oi ? text : o)) })}
                      placeholder={t("quiz.optionPlaceholder", { n: oi + 1 })}
                      placeholderTextColor={MUTED}
                      maxLength={100}
                      style={{ flex: 1, color: WHITE, fontSize: 14, borderBottomWidth: 1, borderColor: LINE, paddingVertical: 6 }}
                    />
                  </View>
                ))}
              </View>
            ))}

            {draft.questions.length > 0 && draft.questions.length < MAX_QUESTIONS && (
              <Pressable
                onPress={() => setDraft((d) => ({ ...d, questions: [...d.questions, { q: "", options: ["", "", "", ""], answer: 0 }] }))}
                accessibilityRole="button"
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 }}>
                  <Icon name="Plus" size={16} color={WHITE} />
                  <Text style={{ color: WHITE, fontSize: 14 }}>{t("quiz.addQuestion")}</Text>
                </View>
              </Pressable>
            )}

            {draft.questions.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text style={{ color: MUTED, fontSize: 13 }}>{t("quiz.pointsLabel")}</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {POINTS.map((p) => (
                    <Pressable key={p} onPress={() => setDraft((d) => ({ ...d, pointsPerQuestion: p }))} accessibilityRole="radio" accessibilityState={{ checked: draft.pointsPerQuestion === p }}>
                      <View style={{ borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: draft.pointsPerQuestion === p ? WHITE : LINE, backgroundColor: draft.pointsPerQuestion === p ? "rgba(255,255,255,0.12)" : "transparent" }}>
                        <Text style={{ color: WHITE, fontSize: 14 }}>{p}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default QuizEditorSheet;
