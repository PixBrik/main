import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { LegalPageFrame } from '../components/legal';
import {
  CONTACT_COPY,
  isRtlLocale,
  LEGAL_BACK_LABEL,
  type ContactTopic,
  type LegalLocale,
} from '../legal/legalContent';
import { useLegalLocale } from '../legal/useLegalLocale';
import {
  CONTACT_EMAIL_MAX_LENGTH,
  CONTACT_MESSAGE_MAX_LENGTH,
  CONTACT_MESSAGE_MIN_LENGTH,
  CONTACT_NAME_MAX_LENGTH,
  CONTACT_ORDER_REFERENCE_MAX_LENGTH,
  CONTACT_PRIVACY_NOTICE_VERSION,
  ContactFormRequestError,
  createContactSubmissionId,
  isValidContactEmail,
  isValidContactName,
  isValidContactOrderReference,
  submitContactForm,
} from '../lib/contactForm';
import { colors, fonts, inkAlpha, radius, spacing } from '../theme/tokens';

export const CONTACT_RECIPIENT = 'hello@pixbrik.com' as const;

export interface ContactSubmission {
  email: string;
  locale: LegalLocale;
  message: string;
  name: string;
  orderNumber?: string;
  privacyNoticePresentedAt: number;
  privacyNoticeVersion: typeof CONTACT_PRIVACY_NOTICE_VERSION;
  topic: ContactTopic;
}

interface ContactScreenProps {
  locale?: LegalLocale;
  onBack?: () => void;
  onLocaleChange?: (locale: LegalLocale) => void;
  /** Submit to a server endpoint; Resend credentials must never be used in this component. */
  onSubmit?: (submission: ContactSubmission) => Promise<void>;
}

const TOPIC_ORDER: readonly ContactTopic[] = [
  'order',
  'wrong-damaged',
  'privacy',
  'billing',
  'other',
] as const;

export function ContactScreen({
  locale: localeValue,
  onBack,
  onLocaleChange,
  onSubmit,
}: ContactScreenProps) {
  const [locale, setLocale] = useLegalLocale(localeValue, onLocaleChange);
  const copy = CONTACT_COPY[locale];
  const rtl = isRtlLocale(locale);
  const textDirection = rtl ? styles.rtlText : styles.ltrText;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [topic, setTopic] = useState<ContactTopic>('order');
  const [message, setMessage] = useState('');
  const [companyWebsite, setCompanyWebsite] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [feedback, setFeedback] = useState('');
  const formSession = useRef({
    formStartedAt: Date.now(),
    privacyNoticePresentedAt: Date.now(),
  });
  const submissionId = useRef(createContactSubmissionId());

  const submit = async () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedMessage = message.trim();
    const trimmedOrderNumber = orderNumber.trim();
    if (
      !isValidContactName(trimmedName) ||
      trimmedMessage.length < CONTACT_MESSAGE_MIN_LENGTH ||
      trimmedMessage.length > CONTACT_MESSAGE_MAX_LENGTH ||
      !isValidContactOrderReference(trimmedOrderNumber)
    ) {
      setStatus('error');
      setFeedback(copy.requiredMessage);
      return;
    }
    if (!isValidContactEmail(trimmedEmail)) {
      setStatus('error');
      setFeedback(copy.invalidEmailMessage);
      return;
    }

    setStatus('sending');
      setFeedback('');
    try {
      const publicSubmission: ContactSubmission = {
        email: trimmedEmail,
        locale,
        message: trimmedMessage,
        name: trimmedName,
        orderNumber: trimmedOrderNumber || undefined,
        privacyNoticePresentedAt: formSession.current.privacyNoticePresentedAt,
        privacyNoticeVersion: CONTACT_PRIVACY_NOTICE_VERSION,
        topic,
      };
      if (onSubmit) {
        await onSubmit(publicSubmission);
      } else {
        await submitContactForm({
          companyWebsite,
          email: publicSubmission.email,
          formStartedAt: formSession.current.formStartedAt,
          locale: publicSubmission.locale,
          message: publicSubmission.message,
          name: publicSubmission.name,
          orderReference: publicSubmission.orderNumber,
          privacyNoticePresentedAt: publicSubmission.privacyNoticePresentedAt,
          privacyNoticeVersion: publicSubmission.privacyNoticeVersion,
          submissionId: submissionId.current,
          topic: publicSubmission.topic,
        }, { runtime: Platform.OS === 'web' ? 'web' : 'native' });
      }
      setStatus('sent');
      setFeedback(copy.sentMessage);
      setMessage('');
      setCompanyWebsite('');
      const resetAt = Date.now();
      formSession.current = {
        formStartedAt: resetAt,
        privacyNoticePresentedAt: resetAt,
      };
      submissionId.current = createContactSubmissionId();
    } catch (error) {
      setStatus('error');
      if (error instanceof ContactFormRequestError && error.field === 'email') {
        setFeedback(copy.invalidEmailMessage);
      } else if (error instanceof ContactFormRequestError && error.status === 400) {
        setFeedback(copy.requiredMessage);
      } else {
        setFeedback(copy.sendErrorMessage);
      }
    }
  };

  return (
    <LegalPageFrame
      backLabel={LEGAL_BACK_LABEL[locale]}
      eyebrow={copy.eyebrow}
      locale={locale}
      onBack={onBack}
      onLocaleChange={setLocale}
      subtitle={copy.subtitle}
      title={copy.title}
    >
      <View style={styles.destination}>
        <Text selectable style={[styles.destinationText, rtl && styles.arabicBody, textDirection]}>
          {copy.directEmailLabel}
        </Text>
      </View>

      <View style={styles.form}>
        <FieldLabel label={copy.nameLabel} rtl={rtl} />
        <TextInput
          accessibilityLabel={copy.nameLabel}
          autoComplete="name"
          maxLength={CONTACT_NAME_MAX_LENGTH}
          onChangeText={setName}
          style={[styles.input, rtl && styles.arabicBody, textDirection]}
          value={name}
        />

        <FieldLabel label={copy.emailLabel} rtl={rtl} />
        <TextInput
          accessibilityLabel={copy.emailLabel}
          autoCapitalize="none"
          autoComplete="email"
          inputMode="email"
          keyboardType="email-address"
          maxLength={CONTACT_EMAIL_MAX_LENGTH}
          onChangeText={setEmail}
          style={[styles.input, styles.ltrInput]}
          value={email}
        />

        <FieldLabel label={copy.orderLabel} rtl={rtl} />
        <TextInput
          accessibilityLabel={copy.orderLabel}
          autoCapitalize="characters"
          maxLength={CONTACT_ORDER_REFERENCE_MAX_LENGTH}
          onChangeText={setOrderNumber}
          style={[styles.input, styles.ltrInput]}
          value={orderNumber}
        />

        <FieldLabel label={copy.topicLabel} rtl={rtl} />
        <View style={[styles.topicList, rtl && styles.rowReverse]}>
          {TOPIC_ORDER.map((topicOption) => {
            const selected = topicOption === topic;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={topicOption}
                onPress={() => setTopic(topicOption)}
                style={({ pressed }) => [
                  styles.topicButton,
                  selected && styles.topicButtonSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.topicText,
                    rtl && styles.arabicLabel,
                    selected && styles.topicTextSelected,
                    textDirection,
                  ]}
                >
                  {copy.topics[topicOption]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <FieldLabel label={copy.messageLabel} rtl={rtl} />
        <TextInput
          accessibilityLabel={copy.messageLabel}
          maxLength={CONTACT_MESSAGE_MAX_LENGTH}
          multiline
          numberOfLines={7}
          onChangeText={setMessage}
          style={[styles.input, styles.messageInput, rtl && styles.arabicBody, textDirection]}
          textAlignVertical="top"
          value={message}
        />

        <View style={[styles.privacyRow, rtl && styles.rowReverse]}>
          <View
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.noticeIcon}
          >
            <Text style={styles.noticeIconText}>i</Text>
          </View>
          <Text style={[styles.privacyNote, rtl && styles.arabicBody, textDirection]}>
            {copy.formPrivacyNote}
          </Text>
        </View>

        <TextInput
          accessible={false}
          accessibilityElementsHidden
          aria-hidden
          autoComplete="off"
          importantForAccessibility="no-hide-descendants"
          onChangeText={setCompanyWebsite}
          style={styles.honeypot}
          tabIndex={-1}
          value={companyWebsite}
        />

        {feedback ? (
          <Text
            accessibilityLiveRegion="polite"
            accessibilityRole={status === 'error' ? 'alert' : 'text'}
            style={[
              styles.feedback,
              status === 'error' ? styles.feedbackError : styles.feedbackSuccess,
              rtl && styles.arabicBody,
              textDirection,
            ]}
          >
            {feedback}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: status === 'sending' }}
          disabled={status === 'sending'}
          onPress={() => void submit()}
          style={({ pressed }) => [styles.submit, pressed && styles.pressed]}
        >
          <Text style={[styles.submitText, rtl && styles.arabicHeading]}>
            {status === 'sending' ? copy.sendingLabel : copy.sendLabel}
          </Text>
        </Pressable>
      </View>
    </LegalPageFrame>
  );
}

function FieldLabel({ label, rtl }: { label: string; rtl: boolean }) {
  return (
    <Text style={[styles.label, rtl && styles.arabicLabel, rtl ? styles.rtlText : styles.ltrText]}>
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  destination: {
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  destinationText: {
    color: colors.saffron,
    fontFamily: fonts.extrabold,
    fontSize: 13,
    lineHeight: 19,
  },
  form: {
    backgroundColor: colors.white,
    borderColor: colors.ink,
    borderRadius: radius.lg,
    borderWidth: 2,
    marginTop: spacing.lg,
    padding: spacing.xl,
  },
  label: {
    color: colors.ink,
    fontFamily: fonts.extrabold,
    fontSize: 11,
    letterSpacing: 0.7,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#FFF9E8',
    borderColor: inkAlpha(0.3),
    borderRadius: radius.md,
    borderWidth: 1.5,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 15,
    minHeight: 50,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  ltrInput: {
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  messageInput: {
    minHeight: 156,
  },
  topicList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  topicButton: {
    borderColor: inkAlpha(0.3),
    borderRadius: radius.pill,
    borderWidth: 1.5,
    minHeight: 42,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  topicButtonSelected: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  topicText: {
    color: colors.ink,
    fontFamily: fonts.bold,
    fontSize: 12,
    lineHeight: 18,
  },
  topicTextSelected: {
    color: colors.saffron,
  },
  privacyNote: {
    color: inkAlpha(0.62),
    fontFamily: fonts.medium,
    fontSize: 11,
    lineHeight: 17,
    flex: 1,
  },
  privacyRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  noticeIcon: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderColor: colors.ink,
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  noticeIconText: {
    color: colors.saffron,
    fontSize: 13,
    fontWeight: '900',
  },
  honeypot: {
    height: 1,
    left: -10_000,
    opacity: 0,
    position: 'absolute',
    top: -10_000,
    width: 1,
  },
  feedback: {
    borderRadius: radius.md,
    fontFamily: fonts.bold,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  feedbackError: {
    backgroundColor: 'rgba(255, 61, 23, 0.1)',
    color: colors.alarm,
  },
  feedbackSuccess: {
    backgroundColor: inkAlpha(0.08),
    color: colors.ink,
  },
  submit: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    justifyContent: 'center',
    marginTop: spacing.lg,
    minHeight: 56,
    paddingHorizontal: spacing.xl,
  },
  submitText: {
    color: colors.saffron,
    fontFamily: fonts.display,
    fontSize: 16,
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.99 }],
  },
  ltrText: {
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  rtlText: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  arabicHeading: {
    fontFamily: undefined,
    fontWeight: '900',
    letterSpacing: 0,
  },
  arabicBody: {
    fontFamily: undefined,
    fontWeight: '500',
    lineHeight: 25,
  },
  arabicLabel: {
    fontFamily: undefined,
    fontWeight: '800',
    letterSpacing: 0,
    textTransform: 'none',
  },
});
