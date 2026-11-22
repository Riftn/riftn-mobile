import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import { useAuthActions, useAuthState } from "../../context/AuthContext";
import { answerQuiz, getQuiz, type PostQuiz } from "../../services/quiz.service";
import { formatCount } from "../../libs/format-count";
import { toastError, toastSuccess } from "../../libs";

/**
 * A post's quiz: one question at a time, one go per person, marked on the
 * server. Right answers earn the creator's channel points, boosted by the
 * reader's badge. Sits under the caption wherever the post's poll would be.
 */
const QuizCard: React.FC<{ tokenId: number }> = ({ tokenId }) => {
  const { t } = useTranslation();
  const { isSignedIn } = useAuthState();
  const { requireAuth } = useAuthActions();
  const [quiz, setQuiz] = useState<PostQuiz | null>(null);
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<number[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    getQuiz(tokenId, isSignedIn)
      .then((res) => { if (alive) setQuiz(res?.quiz ?? null); })
      .catch(() => { if (alive) setQuiz(null); });
    return () => { alive = false; };
  }, [tokenId, isSignedIn]);

  if (!quiz || !quiz.questions?.length) return null;

  const done = quiz.isCreator || !!quiz.mine;
  const total = quiz.questions.length;

  const send = async (answers: number[]) => {
    setSending(true);
    try {
      const result = await answerQuiz(tokenId, answers);
      setQuiz((old) => old ? {
        ...old,
        attempts: old.attempts + 1,
        questions: result.questions,
        mine: { answers: result.answers, correct: result.correct, total: result.total, points: result.points, multiplier: result.multiplier },
      } : old);
      toastSuccess(result.points > 0
        ? t("quiz.earnedToast", { correct: result.correct, total: result.total, points: formatCount(result.points) })
        : t("quiz.noPointsToast", { correct: result.correct, total: result.total }));
    } catch (err: any) {
      toastError(err?.message || t("quiz.answerFailed"));
      setStep(0);
      setPicked([]);
    } finally {
      setSending(false);
    }
  };

  const pick = (index: number) => {
    if (sending) return;
    const go = () => {
      const next = [...picked.slice(0, step), index];
      setPicked(next);
      if (step < total - 1) setStep(step + 1);
      else void send(next);
    };
    if (!isSignedIn) { requireAuth?.(go); return; }
    go();
  };

  const question = quiz.questions[step];

  return (
    <View className="mx-2 my-1.5 rounded-xl bg-white/5 border border-white/10 p-3" style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
          <Icon name="Trophy" size={16} color="#F4F4F5" />
          <Text className="text-white font-medium text-sm" style={{ flexShrink: 1 }}>{quiz.topic || t("quiz.title")}</Text>
        </View>
        <Text className="text-zinc-400 text-[12px]">{t("quiz.taken", { value: formatCount(quiz.attempts) })}</Text>
      </View>

      {done ? (
        <QuizReview quiz={quiz} />
      ) : (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text className="text-zinc-400 text-[12px]">{t("quiz.questionOf", { n: step + 1, total })}</Text>
            <Text className="text-zinc-400 text-[12px]">
              {t("quiz.pointsEach", { points: formatCount(Math.round(quiz.pointsPerQuestion * (quiz.multiplier || 1))) })}
            </Text>
          </View>
          <Text className="text-white text-[15px]" style={{ lineHeight: 20 }}>{question?.q}</Text>
          {question?.options.map((option, i) => (
            <Pressable key={i} disabled={sending} onPress={() => pick(i)} accessibilityRole="button">
              {/* The fill lives on an inner View: the app repaints Pressable fills. */}
              <View className="rounded-lg bg-white/10 px-3 py-2" style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, opacity: sending ? 0.6 : 1 }}>
                {sending && step === total - 1 && picked[step] === i ? <ActivityIndicator size="small" color="#F4F4F5" /> : null}
                <Text className="text-zinc-300 text-sm" style={{ flex: 1 }}>{option}</Text>
              </View>
            </Pressable>
          ))}
          {quiz.multiplier > 1 && (
            <Text className="text-zinc-500 text-[12px]">{t("quiz.badgeBoost", { x: quiz.multiplier })}</Text>
          )}
        </View>
      )}
    </View>
  );
};

const QuizReview: React.FC<{ quiz: PostQuiz }> = ({ quiz }) => {
  const { t } = useTranslation();
  const mine = quiz.mine;
  return (
    <View style={{ gap: 10 }}>
      {mine && (
        <Text className="text-white text-sm">
          {mine.points > 0
            ? t("quiz.resultPoints", { correct: mine.correct, total: mine.total, points: formatCount(mine.points) })
            : t("quiz.result", { correct: mine.correct, total: mine.total })}
        </Text>
      )}
      {quiz.isCreator && <Text className="text-zinc-400 text-[12px]">{t("quiz.creatorNote")}</Text>}
      {quiz.questions.map((question, qi) => (
        <View key={qi} style={{ gap: 4 }}>
          <Text className="text-white text-sm">{qi + 1}. {question.q}</Text>
          {question.options.map((option, oi) => {
            const right = question.answer === oi;
            const chosen = mine?.answers[qi] === oi;
            return (
              <View
                key={oi}
                className={`rounded-lg px-3 py-1.5 ${right ? "bg-white/15" : chosen ? "bg-red-500/15" : ""}`}
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                {right ? <Icon name="Check" size={14} color="#F4F4F5" /> : chosen ? <Icon name="X" size={14} color="#FECACA" /> : <View style={{ width: 14 }} />}
                <Text className={`text-sm ${right ? "text-white" : chosen ? "text-red-300" : "text-zinc-400"}`} style={{ flex: 1 }}>{option}</Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
};

export default React.memo(QuizCard);
