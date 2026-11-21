import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { ethers } from 'ethers';
import { useTranslation } from 'react-i18next';
import GlassModal from '../ui/GlassModal';
import { useAppTheme } from '../../context/ThemeContext';
import { ChainId } from '../../config/constants';
import { DHB_TOKEN_ADDRESSES, STREAM_CONTROLLER_CONTRACT_ADDRESSES } from '../../config/web3.constants';
import tokenAbi from '../../config/abis/erc20.json';
import controllerAbi from '../../config/abis/stream-controller.json';
import { useDexSigner } from '../../hooks/useDexSigner';
import { buildContract, prepareDhbSpend } from '../../hooks/use-web3';
import { writeContractAA } from '../../libs/aa.write';
import { runEventCheckout, isEntryHash, type GateOutcome } from '../../libs/event-checkout';
import { eventGateRequest, type CommunityEvent } from '../../services/events.service';

export default function EventCheckoutSheet({ event, wallet, onClose, onPaid }: {
  event: CommunityEvent; wallet: string; onClose: () => void; onPaid: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const signerFor = useDexSigner();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<GateOutcome | null>(null);
  const [hash, setHash] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const request = (action: string, claim: string, tx?: string) => eventGateRequest(event.id, wallet, action, claim, tx);
  const recovering = result?.state === 'pending' || result?.state === 'recover';

  async function pay() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const outcome = await runEventCheckout(event, wallet, randomUUID(), {
        request, storage: AsyncStorage, pause: () => new Promise(resolve => setTimeout(resolve, 2000)),
        send: async (reference, beforeSubmit) => {
          const chain = ChainId.BASE_MAINNET;
          const provider = await signerFor(chain, t('wallet.notReady'));
          const token = await buildContract(provider, tokenAbi, DHB_TOKEN_ADDRESSES[chain]);
          if (!token) throw new Error(t('wallet.notReady'));
          const checkSigner = async () => {
            if (!mounted.current || await token.signer.getChainId() !== chain ||
                (await token.signer.getAddress()).toLowerCase() !== wallet.toLowerCase()) {
              throw new Error(t('events.entrySigner', { defaultValue: 'Select your signed-in wallet on Base.' }));
            }
          };
          await checkSigner();
          const recipient = event.creator_wallet_address;
          const amount = ethers.utils.parseUnits(String(event.gate_fee), 18);
          const controller = new ethers.Contract(STREAM_CONTROLLER_CONTRACT_ADDRESSES[chain], controllerAbi, token.signer);
          await prepareDhbSpend(token, controller.address, amount);
          const sent = await writeContractAA(controller, 'sendTip', [reference, amount, recipient, token.address], {
            context: 'event entry', beforeSubmit: async () => { await checkSigner(); await beforeSubmit(); },
          });
          return sent.hash;
        },
      }, recovering ? { hash: hash.trim() } : undefined);
      if (!mounted.current) return;
      if (outcome.state === 'paid') { onPaid(); return; }
      setResult(outcome);
      if ('hash' in outcome) setHash(outcome.hash ?? '');
      if (outcome.state === 'reverted') setError(t('events.entryReverted', { defaultValue: 'The entry payment reverted on Base.' }));
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : t('common.somethingWentWrong'));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function release(claim: string) {
    Alert.alert(t('events.clearEntry', { defaultValue: 'Clear unused attempt?' }),
      t('events.clearEntryHelp', { defaultValue: 'Only clear this attempt after closing the original wallet request and checking that your wallet has no pending or completed payment.' }), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.confirm'), onPress: async () => {
          try { await request('release', claim); setResult(null); setHash(''); setError(''); }
          catch (e) { setError(e instanceof Error ? e.message : t('common.somethingWentWrong')); }
        } },
      ]);
  }
  const disabled = busy || Boolean(recovering && hash.trim() && !isEntryHash(hash.trim()));
  return (
    <GlassModal visible onClose={onClose} presentation="bottom" dismissible={!busy}>
      <View style={{ padding: 20, gap: 14 }}>
        <Text style={{ color: colors.foreground, fontSize: 20, fontWeight: '700' }}>{event.title}</Text>
        <Text style={{ color: colors.foreground }}>{t('events.entryFeeCoins', { count: event.gate_fee })} · Base</Text>
        {recovering && <>
          <Text style={{ color: colors.foreground }}>{t('events.entryReceiptHelp', { defaultValue: 'Check your existing payment using the Base transaction hash from your wallet.' })}</Text>
          <TextInput value={hash} onChangeText={setHash} editable={!busy} autoCapitalize="none" autoCorrect={false}
            accessibilityLabel={t('events.entryHash', { defaultValue: 'Base transaction hash' })} placeholder="0x…"
            style={{ color: colors.foreground, borderColor: colors.border, borderWidth: 1, padding: 10 }} />
        </>}
        {Boolean(error) && <Text accessibilityLiveRegion="polite" style={{ color: colors.foreground }}>{error}</Text>}
        <Pressable accessibilityRole="button" onPress={pay} disabled={disabled}
          style={{ padding: 14, borderRadius: 12, alignItems: 'center', backgroundColor: colors.accent, opacity: disabled ? 0.6 : 1 }}>
          {busy ? <ActivityIndicator color={colors.accentForeground} /> : <Text style={{ color: colors.accentForeground }}>
            {recovering ? t('events.checkEntry', { defaultValue: 'Check payment' }) : t('events.payToJoin')}
          </Text>}
        </Pressable>
        {result?.state === 'recover' && result.staleClaim && !busy &&
          <Text accessibilityRole="button" style={{ color: colors.foreground }} onPress={() => release(result.staleClaim!)}>
            {t('events.clearEntry', { defaultValue: 'Clear unused attempt?' })}
          </Text>}
      </View>
    </GlassModal>
  );
}
