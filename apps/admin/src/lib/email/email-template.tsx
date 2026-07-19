import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
  render
} from "react-email";

export type EmailPurpose = "transactional" | "marketing";

export type EmailContentDefinition = Readonly<{
  purpose: EmailPurpose;
  heading: string;
  body: string;
  ctaLabel: string;
  ctaPath: string;
  previewText: string | null;
  themeVersion: number;
}>;

type PixBrikEmailProps = Readonly<{
  previewText?: string | null;
  content: EmailContentDefinition;
  ctaUrl: string;
  locale: string;
  unsubscribeUrl?: string;
}>;

function requiredString(
  value: unknown,
  label: string,
  maximumLength: number
): string {
  if (typeof value !== "string") throw new Error(`Email template ${label} is missing`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new Error(`Email template ${label} is invalid`);
  }
  return normalized;
}

export function parseEmailContentDefinition(value: unknown): EmailContentDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Email template content is invalid");
  }
  const record = value as Record<string, unknown>;
  const purpose = record.purpose;
  if (purpose !== "transactional" && purpose !== "marketing") {
    throw new Error("Email template purpose is invalid");
  }
  const themeVersion = Number(record.themeVersion);
  if (!Number.isSafeInteger(themeVersion) || themeVersion < 1 || themeVersion > 100) {
    throw new Error("Email template theme version is invalid");
  }
  const ctaPath = requiredString(record.ctaPath, "CTA path", 2_000);
  if (!ctaPath.startsWith("/") && !/^https:\/\//i.test(ctaPath)) {
    throw new Error("Email template CTA must be a path or HTTPS URL");
  }
  return {
    purpose,
    heading: requiredString(record.heading, "heading", 180),
    body: requiredString(record.body, "body", 4_000),
    ctaLabel: requiredString(record.ctaLabel, "CTA label", 80),
    ctaPath,
    previewText: record.previewText == null
      ? null
      : requiredString(record.previewText, "preview text", 240),
    themeVersion
  };
}

function payloadString(payload: unknown, key: string, maximumLength: number): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength || /[\r\n\p{C}]/u.test(normalized)) return null;
  return normalized;
}

export function personalizeEmailContent(
  content: EmailContentDefinition,
  payload: unknown,
  locale: string
): EmailContentDefinition {
  const orderNumber = payloadString(payload, "orderNumber", 80);
  if (!orderNumber) return content;
  const label = locale === "fr" ? "Référence de commande"
    : locale === "es" ? "Referencia del pedido"
      : locale === "it" ? "Riferimento ordine"
        : locale === "ar" ? "مرجع الطلب"
          : "Order reference";
  return { ...content, body: `${content.body}\n\n${label}: ${orderNumber}` };
}

export function PixBrikEmail({
  previewText,
  content,
  ctaUrl,
  locale,
  unsubscribeUrl
}: PixBrikEmailProps) {
  const rtl = locale === "ar";
  if (content.purpose === "marketing" && !unsubscribeUrl) {
    throw new Error("Marketing email requires an unsubscribe URL");
  }
  const labels = localizedLabels(locale);
  return (
    <Html lang={locale} dir={rtl ? "rtl" : "ltr"}>
      <Head />
      {previewText ? <Preview>{previewText}</Preview> : null}
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.brandBar}>
            <Text style={styles.brand}>PIXBRIK</Text>
            <Text style={styles.brandDots}>. . . .</Text>
          </Section>
          <Section style={styles.content}>
            <Text style={styles.eyebrow}>
              {content.purpose === "marketing" ? labels.ideas : labels.update}
            </Text>
            <Heading as="h1" style={styles.heading}>{content.heading}</Heading>
            {content.body.split(/\n{2,}/u).map((paragraph) => (
              <Text style={styles.paragraph} key={paragraph}>{paragraph}</Text>
            ))}
            <Button href={ctaUrl} style={styles.button}>{content.ctaLabel}</Button>
            <Hr style={styles.rule} />
            <Text style={styles.footer}>
              PixBrik | 173 rue de Courcelles | 75017 Paris, France
            </Text>
            {content.purpose === "marketing" && unsubscribeUrl ? (
              <Text style={styles.footer}>
                {labels.permission} {" "}
                <Link href={unsubscribeUrl} style={styles.link}>{labels.unsubscribe}</Link>
              </Text>
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderPixBrikEmail(props: PixBrikEmailProps): Promise<string> {
  return render(<PixBrikEmail {...props} />);
}

export function pixBrikEmailText({
  content,
  ctaUrl,
  unsubscribeUrl,
  locale
}: Pick<PixBrikEmailProps, "content" | "ctaUrl" | "unsubscribeUrl" | "locale">): string {
  const lines = [content.heading, "", content.body, "", `${content.ctaLabel}: ${ctaUrl}`];
  if (content.purpose === "marketing" && unsubscribeUrl) {
    lines.push("", `${localizedLabels(locale).unsubscribe}: ${unsubscribeUrl}`);
  }
  lines.push("", "PixBrik | 173 rue de Courcelles | 75017 Paris, France");
  return lines.join("\n");
}

function localizedLabels(locale: string): Readonly<{
  ideas: string;
  update: string;
  permission: string;
  unsubscribe: string;
}> {
  if (locale === "fr") return {
    ideas: "ID\u00c9ES PIXBRIK",
    update: "ACTUALIT\u00c9 PIXBRIK",
    permission: "Vous recevez cet e-mail car vous avez demand\u00e9 les actualit\u00e9s PixBrik.",
    unsubscribe: "Se d\u00e9sabonner"
  };
  if (locale === "es") return {
    ideas: "IDEAS PIXBRIK",
    update: "NOVEDADES PIXBRIK",
    permission: "Recibes este correo porque solicitaste noticias de PixBrik.",
    unsubscribe: "Darse de baja"
  };
  if (locale === "it") return {
    ideas: "IDEE PIXBRIK",
    update: "NOVIT\u00c0 PIXBRIK",
    permission: "Ricevi questa email perch\u00e9 hai richiesto le novit\u00e0 PixBrik.",
    unsubscribe: "Annulla iscrizione"
  };
  if (locale === "ar") return {
    ideas: "\u0623\u0641\u0643\u0627\u0631 PIXBRIK",
    update: "\u062a\u062d\u062f\u064a\u062b PIXBRIK",
    permission: "\u062a\u0635\u0644\u0643 \u0647\u0630\u0647 \u0627\u0644\u0631\u0633\u0627\u0644\u0629 \u0644\u0623\u0646\u0643 \u0637\u0644\u0628\u062a \u0623\u062e\u0628\u0627\u0631 PixBrik.",
    unsubscribe: "\u0625\u0644\u063a\u0627\u0621 \u0627\u0644\u0627\u0634\u062a\u0631\u0627\u0643"
  };
  return {
    ideas: "PIXBRIK IDEAS",
    update: "PIXBRIK UPDATE",
    permission: "You received this because you asked for PixBrik news.",
    unsubscribe: "Unsubscribe"
  };
}

const styles = {
  body: {
    margin: "0",
    backgroundColor: "#f4eedc",
    color: "#17130a",
    fontFamily: "Arial, Helvetica, sans-serif"
  },
  container: {
    width: "100%",
    maxWidth: "620px",
    margin: "32px auto",
    border: "3px solid #17130a",
    backgroundColor: "#fffdf7"
  },
  brandBar: {
    padding: "22px 28px 18px",
    backgroundColor: "#ffc800",
    borderBottom: "3px solid #17130a"
  },
  brand: {
    margin: "0",
    color: "#17130a",
    fontSize: "25px",
    fontWeight: "900",
    letterSpacing: "-1px"
  },
  brandDots: {
    margin: "2px 0 0",
    color: "#17130a",
    fontSize: "7px",
    letterSpacing: "3px"
  },
  content: { padding: "34px 32px 26px" },
  eyebrow: {
    margin: "0 0 10px",
    color: "#726f65",
    fontSize: "11px",
    fontWeight: "800",
    letterSpacing: "1.7px"
  },
  heading: {
    margin: "0 0 20px",
    color: "#17130a",
    fontSize: "38px",
    lineHeight: "1.02",
    letterSpacing: "-1.4px"
  },
  paragraph: {
    margin: "0 0 18px",
    color: "#3e3a32",
    fontSize: "17px",
    lineHeight: "1.55"
  },
  button: {
    display: "inline-block",
    margin: "8px 0 28px",
    padding: "14px 20px",
    border: "2px solid #17130a",
    backgroundColor: "#ffc800",
    color: "#17130a",
    fontSize: "14px",
    fontWeight: "900",
    textDecoration: "none",
    textTransform: "uppercase" as const
  },
  rule: { borderColor: "#d9d3c3", margin: "4px 0 20px" },
  footer: {
    margin: "6px 0",
    color: "#726f65",
    fontSize: "11px",
    lineHeight: "1.5"
  },
  link: { color: "#17130a", textDecoration: "underline" }
} as const;
