import {
  LEGAL_LANGUAGE_VERSIONS,
  LEGAL_JURISDICTIONS,
  LEGAL_MARKETS,
  LEGAL_PRODUCT_TYPES,
  PENDING_LEGAL_JURISDICTION_REVIEWS,
  type LegalDocumentMetadata,
  type LegalLanguageVersion,
} from './legalGovernance';

export type LegalLocale = LegalLanguageVersion;

export type { LegalDocumentMetadata } from './legalGovernance';

export type LegalRoute = 'legal' | 'terms' | 'privacy' | 'contact';

export interface LegalLocaleOption {
  code: LegalLocale;
  direction: 'ltr' | 'rtl';
  label: string;
  shortLabel: string;
}

export const LEGAL_LOCALES: readonly LegalLocaleOption[] = [
  { code: 'en', direction: 'ltr', label: 'English', shortLabel: 'EN' },
  { code: 'fr', direction: 'ltr', label: 'Français', shortLabel: 'FR' },
  { code: 'es', direction: 'ltr', label: 'Español', shortLabel: 'ES' },
  { code: 'it', direction: 'ltr', label: 'Italiano', shortLabel: 'IT' },
  { code: 'ar', direction: 'rtl', label: 'العربية', shortLabel: 'ع' },
] as const;

export function isRtlLocale(locale: LegalLocale) {
  return locale === 'ar';
}

export interface LegalSection {
  heading: string;
  paragraphs: readonly string[];
  bullets?: readonly string[];
}

export interface LegalDocumentCopy {
  counselReviewLabel: string;
  eyebrow: string;
  lastUpdatedLabel: string;
  sections: readonly LegalSection[];
  subtitle: string;
  title: string;
}

export interface LegalHubCopy {
  contactDescription: string;
  contactTitle: string;
  counselReviewLabel: string;
  eyebrow: string;
  privacyDescription: string;
  privacyTitle: string;
  subtitle: string;
  termsDescription: string;
  termsTitle: string;
  title: string;
}

export const LEGAL_BACK_LABEL: Record<LegalLocale, string> = {
  en: 'Back',
  fr: 'Retour',
  es: 'Volver',
  it: 'Indietro',
  ar: 'رجوع',
};

export type ContactTopic = 'order' | 'wrong-damaged' | 'privacy' | 'billing' | 'other';

export interface ContactCopy {
  directEmailLabel: string;
  emailLabel: string;
  eyebrow: string;
  formPrivacyNote: string;
  invalidEmailMessage: string;
  invalidNameMessage: string;
  invalidOrderMessage: string;
  messageLabel: string;
  messageLengthHelp: string;
  messageLengthMessage: string;
  nameLabel: string;
  orderLabel: string;
  privacyNoticeErrorMessage: string;
  requiredMessage: string;
  sendErrorMessage: string;
  sendLabel: string;
  sendingLabel: string;
  sentMessage: string;
  subtitle: string;
  title: string;
  topicLabel: string;
  topics: Readonly<Record<ContactTopic, string>>;
}

export const TERMS_METADATA: LegalDocumentMetadata = {
  documentId: 'terms-of-sale',
  documentOwner: 'PixBrik',
  publishable: false,
  status: 'draft-counsel-review',
  version: '2026-07-18-draft.2',
  revision: 2,
  lastEditedAt: '2026-07-18',
  effectiveAt: null,
  supersedesVersion: '2026-07-18-draft.1',
  applicability: {
    intendedMarkets: LEGAL_MARKETS,
    intendedJurisdictions: LEGAL_JURISDICTIONS,
    productTypes: ['personalised-physical-brick-kit'],
    languageVersions: LEGAL_LANGUAGE_VERSIONS,
    languageVersionsAreJurisdictionalVariants: false,
    scopeNote:
      'Unapproved baseline only for personalised physical-kit orders in the intended jurisdictions. It does not govern a separately sold generation service, digital content or support service. Each language × jurisdiction × product × use combination requires its own recorded approval.',
  },
  approval: {
    approvedAt: null,
    approvedBy: null,
    approvedVersion: null,
    businessReview: 'pending',
    counselReview: 'pending',
    languageReviews: {
      en: 'pending',
      fr: 'pending',
      es: 'pending',
      it: 'pending',
      ar: 'pending',
    },
    jurisdictionReviews: PENDING_LEGAL_JURISDICTION_REVIEWS,
    marketReviews: {
      eu: 'pending',
      uk: 'pending',
      us: 'pending',
      canada: 'pending',
      australia: 'pending',
      'middle-east': 'pending',
    },
    permittedUses: [],
    productSafetyReview: 'pending',
    productTypeReviews: {
      'personalised-physical-brick-kit': 'pending',
      'customer-upload-and-generation-service': 'not-applicable',
      'account-order-support': 'not-applicable',
    },
    releaseScopes: [],
  },
  sourceUrls: [
    'https://europa.eu/youreurope/business/selling-in-eu/selling-goods-services/ecommerce-distance-selling/index_en.htm',
    'https://europa.eu/youreurope/business/dealing-with-customers/consumer-contracts-guarantees/consumer-guarantees/index_en.htm',
    'https://eur-lex.europa.eu/eli/reg/2023/988/oj',
  ],
  reviewFlags: [
    'Qualified counsel must approve this exact version for each intended market and language before use; French/EU review alone is not approval for another market.',
    'Confirm the legal entity name, registration details, contact phone, VAT number and appointed consumer mediator.',
    'Complete the market-specific product-safety gate, including applicable GPSR duties for EU sales, product classification, age, warnings, traceability and whether that classification is subject to legislation requiring CE marking.',
    'Confirm where the personalised-goods withdrawal exception applies in every launch market.',
    'Confirm governing-law, dispute-resolution, delivery, customs and country-specific mandatory consumer wording.',
    'Confirm the exact relationship to any third-party brick brands and whether compatibility claims are necessary and supportable.',
    'Do not sell generation services or digital content separately under these physical-kit terms; create a separately reviewed contract and withdrawal/performance flow first.',
  ],
};

export const PRIVACY_METADATA: LegalDocumentMetadata = {
  documentId: 'privacy-notice',
  documentOwner: 'PixBrik',
  publishable: false,
  status: 'draft-counsel-review',
  version: '2026-07-18-draft.2',
  revision: 2,
  lastEditedAt: '2026-07-18',
  effectiveAt: null,
  supersedesVersion: '2026-07-18-draft.1',
  applicability: {
    intendedMarkets: LEGAL_MARKETS,
    intendedJurisdictions: LEGAL_JURISDICTIONS,
    productTypes: LEGAL_PRODUCT_TYPES,
    languageVersions: LEGAL_LANGUAGE_VERSIONS,
    languageVersionsAreJurisdictionalVariants: false,
    scopeNote:
      'Unapproved data-flow baseline for the intended launch jurisdictions. Each language × jurisdiction × product × use combination requires its own recorded approval; language versions are translations only.',
  },
  approval: {
    approvedAt: null,
    approvedBy: null,
    approvedVersion: null,
    businessReview: 'pending',
    counselReview: 'pending',
    languageReviews: {
      en: 'pending',
      fr: 'pending',
      es: 'pending',
      it: 'pending',
      ar: 'pending',
    },
    jurisdictionReviews: PENDING_LEGAL_JURISDICTION_REVIEWS,
    marketReviews: {
      eu: 'pending',
      uk: 'pending',
      us: 'pending',
      canada: 'pending',
      australia: 'pending',
      'middle-east': 'pending',
    },
    permittedUses: [],
    productSafetyReview: 'not-applicable',
    productTypeReviews: {
      'personalised-physical-brick-kit': 'pending',
      'customer-upload-and-generation-service': 'pending',
      'account-order-support': 'pending',
    },
    releaseScopes: [],
  },
  sourceUrls: [
    'https://www.cnil.fr/en/sheet-ndeg12-inform-users',
    'https://www.cnil.fr/en/sheet-ndeg13-prepare-exercise-peoples-rights',
  ],
  reviewFlags: [
    'Qualified privacy counsel must approve this exact version for each intended market and language before use; a translation is not a jurisdictional approval.',
    'Complete the processor/subprocessor list, international-transfer safeguards and retention schedule.',
    'Confirm Meshy, Tripo and any future model provider API retention and training settings before making claims about uploaded images or 3D files.',
    'Add the final cookie/analytics inventory and consent choices.',
    'Confirm the lawful basis for every email, analytics, affiliate and abandoned-checkout workflow.',
    'Confirm the controller registration details and privacy contact channel.',
  ],
};

export const LEGAL_HUB_COPY: Record<LegalLocale, LegalHubCopy> = {
  en: {
    counselReviewLabel: 'Draft content — legal review required before publication',
    eyebrow: 'Trust & information',
    title: 'Legal and contact',
    subtitle: 'Clear information about buying a personalised PixBrik kit and how we handle your data.',
    termsTitle: 'Terms of sale',
    termsDescription: 'Orders, personalised products, delivery and remedies when something goes wrong.',
    privacyTitle: 'Privacy notice',
    privacyDescription: 'How account, order, image and 3D-generation data are used and protected.',
    contactTitle: 'Contact us',
    contactDescription: 'Ask about an order, report a problem or exercise a privacy right.',
  },
  fr: {
    counselReviewLabel: 'Contenu provisoire — validation juridique requise avant publication',
    eyebrow: 'Confiance et informations',
    title: 'Informations légales et contact',
    subtitle: 'Des informations claires sur l’achat d’un kit PixBrik personnalisé et l’utilisation de vos données.',
    termsTitle: 'Conditions de vente',
    termsDescription: 'Commandes, produits personnalisés, livraison et recours en cas de problème.',
    privacyTitle: 'Confidentialité',
    privacyDescription: 'Utilisation et protection des données de compte, de commande, d’image et de génération 3D.',
    contactTitle: 'Nous contacter',
    contactDescription: 'Posez une question, signalez un problème ou exercez un droit relatif à vos données.',
  },
  es: {
    counselReviewLabel: 'Contenido provisional: requiere revisión legal antes de publicarse',
    eyebrow: 'Confianza e información',
    title: 'Información legal y contacto',
    subtitle: 'Información clara sobre la compra de un kit PixBrik personalizado y el uso de tus datos.',
    termsTitle: 'Condiciones de venta',
    termsDescription: 'Pedidos, productos personalizados, entrega y soluciones si surge un problema.',
    privacyTitle: 'Privacidad',
    privacyDescription: 'Cómo se usan y protegen los datos de cuenta, pedidos, imágenes y generación 3D.',
    contactTitle: 'Contacto',
    contactDescription: 'Consulta un pedido, informa de un problema o ejerce un derecho de privacidad.',
  },
  it: {
    counselReviewLabel: 'Contenuto provvisorio: revisione legale richiesta prima della pubblicazione',
    eyebrow: 'Fiducia e informazioni',
    title: 'Informazioni legali e contatti',
    subtitle: 'Informazioni chiare sull’acquisto di un kit PixBrik personalizzato e sull’uso dei tuoi dati.',
    termsTitle: 'Condizioni di vendita',
    termsDescription: 'Ordini, prodotti personalizzati, consegna e rimedi in caso di problemi.',
    privacyTitle: 'Privacy',
    privacyDescription: 'Come utilizziamo e proteggiamo i dati di account, ordini, immagini e generazione 3D.',
    contactTitle: 'Contattaci',
    contactDescription: 'Chiedi informazioni su un ordine, segnala un problema o esercita un diritto privacy.',
  },
  ar: {
    counselReviewLabel: 'محتوى مسودة — تلزم مراجعة قانونية قبل النشر',
    eyebrow: 'الثقة والمعلومات',
    title: 'المعلومات القانونية والتواصل',
    subtitle: 'معلومات واضحة حول شراء مجموعة PixBrik مخصصة وكيفية التعامل مع بياناتك.',
    termsTitle: 'شروط البيع',
    termsDescription: 'الطلبات والمنتجات المخصصة والتوصيل والحلول عند حدوث مشكلة.',
    privacyTitle: 'إشعار الخصوصية',
    privacyDescription: 'كيفية استخدام وحماية بيانات الحساب والطلب والصور والتوليد ثلاثي الأبعاد.',
    contactTitle: 'تواصل معنا',
    contactDescription: 'اسأل عن طلب أو أبلغ عن مشكلة أو مارس أحد حقوق الخصوصية.',
  },
};

export const TERMS_COPY: Record<LegalLocale, LegalDocumentCopy> = {
  en: {
    counselReviewLabel: 'DRAFT — NOT APPROVED FOR PUBLICATION OR CHECKOUT',
    eyebrow: 'Legal',
    title: 'Terms of sale',
    subtitle: 'The proposed terms for personalised PixBrik orders.',
    lastUpdatedLabel: 'Draft version',
    sections: [
      {
        heading: '1. Seller and contact',
        paragraphs: [
          'PixBrik, 173 rue de Courcelles, 75017 Paris, France. Questions about an order can be sent to hello@pixbrik.com. Final company registration, VAT and consumer-mediator details must be inserted before publication.',
        ],
      },
      {
        heading: '2. Personalised products and previews',
        paragraphs: [
          'PixBrik converts customer-provided images or 3D files into a proposed brick build. On-screen previews are digital simulations. Differences caused by screens, pieces, assembly and production are limited to tolerances disclosed before checkout; this does not remove mandatory rights if the supplied kit is materially different, defective or not as described.',
          'Before ordering, the customer must review and confirm the selected design, size, palette, fill, parts estimate and delivery details. PixBrik will supply that customer-confirmed version. A change that materially affects appearance, dimensions, palette, price, parts count or buildability requires an updated preview and renewed customer agreement before production. Only immaterial tolerances disclosed before checkout may apply without renewed agreement.',
        ],
      },
      {
        heading: '3. Your images and permissions',
        paragraphs: [
          'You must own the uploaded content or have permission to use it and to depict every identifiable person. You grant PixBrik and its disclosed service providers a limited licence to process that content only to provide, support and secure the requested service, subject to the Privacy Notice.',
          'Do not upload unlawful, infringing or harmful material. We may refuse or stop an order when reasonably necessary to protect people, rights or the service.',
        ],
      },
      {
        heading: '4. Price, payment and order acceptance',
        paragraphs: [
          'The final checkout must show the total price, currency, tax and shipping before payment. An acknowledgement of payment is not acceptance of an order. The contract is formed when PixBrik confirms that it has accepted the order. If an order cannot be accepted, any captured payment must be returned using the applicable payment method.',
        ],
      },
      {
        heading: '5. Changes, withdrawal and cancellation',
        paragraphs: [
          'Each kit is made to the customer’s specifications. Where the law permits, the statutory change-of-mind withdrawal right may therefore not apply after an order for a clearly personalised product is placed. Production may begin promptly after the customer confirms the design and pays, but the checkout must first disclose the applicable withdrawal position and obtain any acknowledgement required by law.',
          'This does not limit mandatory rights when goods are incorrect, damaged, defective or not as described. Any cancellation right that mandatory law gives you remains unaffected.',
        ],
      },
      {
        heading: '6. Delivery, damage and incorrect goods',
        paragraphs: [
          'The final checkout must display the delivery window and, once verified for the route, the applicable delivery terms and allocation of customs, duties and import charges. A stated estimate is not a guaranteed date unless expressly agreed as one, but calling it an estimate does not remove mandatory delivery rights.',
          'For EU consumer sales, unless another time is agreed, goods must be delivered without undue delay and no later than 30 days after the contract is concluded. If delivery still does not occur within an additional reasonable period allowed by law, the consumer may end the contract and receive the legally required reimbursement. No additional period is required where the seller refuses delivery or an agreed essential deadline is missed. Other markets may provide different or additional rights.',
          'If an item arrives damaged, incomplete or different from the confirmed order, contact hello@pixbrik.com with the order number and any photos or other information reasonably available. This helps us investigate, but is not a condition of a mandatory remedy and does not shorten any legal period. For EU consumer sales, PixBrik bears transit risk until the customer or a designated third party takes physical possession when the carrier was offered or contracted by PixBrik. The exception is where the customer independently commissioned a carrier not offered by PixBrik. The remedy may include repair, replacement, completion, price reduction or refund. Store credit may be offered, but will not replace a remedy required by law without the customer’s agreement.',
        ],
      },
      {
        heading: '7. Safety, assembly and third-party brands',
        paragraphs: [
          'Before any product is offered, PixBrik must complete its product classification and the safety assessment required in each market. For EU sales, applicable General Product Safety Regulation requirements must be met. CE marking is required only when legislation applicable to the classified product requires it, including where the product is classified as a toy; it must not be presented as universally applicable. Required age grades, small-parts warnings, traceability, economic-operator details and conformity records must be complete before sale.',
          'PixBrik is an independent business. LEGO is a trademark of the LEGO Group, which does not sponsor, authorise or endorse PixBrik. Other names and marks belong to their respective owners.',
        ],
      },
      {
        heading: '8. Responsibility and mandatory rights',
        paragraphs: [
          'Nothing in these terms excludes or restricts liability or consumer rights where doing so would be unlawful, including rights relating to defective or misdescribed goods. Customers remain responsible for following supplied safety and assembly instructions and for keeping age-restricted parts away from children below the stated age.',
        ],
      },
      {
        heading: '9. Law and disputes',
        paragraphs: [
          'French law is proposed to govern these terms, without depriving a consumer of mandatory protections that apply in their country of residence. Contact us first so we can try to resolve a concern. The final terms must identify the competent consumer mediation service and any market-specific dispute rights before publication.',
        ],
      },
    ],
  },
  fr: {
    counselReviewLabel: 'PROJET — NON VALIDÉ POUR PUBLICATION OU PAIEMENT',
    eyebrow: 'Juridique',
    title: 'Conditions de vente',
    subtitle: 'Projet de conditions applicables aux commandes PixBrik personnalisées.',
    lastUpdatedLabel: 'Version provisoire',
    sections: [
      {
        heading: '1. Vendeur et contact',
        paragraphs: [
          'PixBrik, 173 rue de Courcelles, 75017 Paris, France. Pour toute question relative à une commande : hello@pixbrik.com. Les informations d’immatriculation, de TVA et du médiateur de la consommation devront être ajoutées avant publication.',
        ],
      },
      {
        heading: '2. Produits personnalisés et aperçus',
        paragraphs: [
          'PixBrik transforme les images ou fichiers 3D fournis par le client en une proposition de construction en briques. Les aperçus à l’écran sont des simulations numériques. Les écarts dus aux écrans, aux pièces, à l’assemblage et à la production sont limités aux tolérances annoncées avant paiement ; cela ne supprime pas les droits impératifs si le kit livré diffère sensiblement, est défectueux ou n’est pas conforme à sa description.',
          'Avant de commander, le client doit vérifier et confirmer le design, la taille, la palette, le remplissage, l’estimation des pièces et la livraison. PixBrik fournira cette version confirmée par le client. Toute modification affectant sensiblement l’aspect, les dimensions, la palette, le prix, le nombre de pièces ou la constructibilité exige un nouvel aperçu et un nouvel accord du client avant production. Seules les tolérances mineures annoncées avant paiement peuvent s’appliquer sans nouvel accord.',
        ],
      },
      {
        heading: '3. Vos images et autorisations',
        paragraphs: [
          'Vous devez détenir les droits sur le contenu transmis ou être autorisé à l’utiliser et à représenter chaque personne identifiable. Vous accordez à PixBrik et à ses prestataires signalés une licence limitée pour traiter ce contenu afin de fournir, assister et sécuriser le service demandé, conformément à l’Avis de confidentialité.',
          'Ne transmettez aucun contenu illicite, contrefaisant ou nuisible. Nous pouvons refuser ou interrompre une commande lorsque cela est raisonnablement nécessaire pour protéger les personnes, les droits ou le service.',
        ],
      },
      {
        heading: '4. Prix, paiement et acceptation',
        paragraphs: [
          'Le paiement final doit indiquer le prix total, la devise, les taxes et la livraison avant tout règlement. Un accusé de paiement ne vaut pas acceptation. Le contrat est conclu lorsque PixBrik confirme qu’elle a accepté la commande. Si la commande ne peut être acceptée, toute somme encaissée doit être restituée via le moyen de paiement applicable.',
        ],
      },
      {
        heading: '5. Modifications, rétractation et annulation',
        paragraphs: [
          'Chaque kit est fabriqué selon les spécifications du client. Lorsque la loi le permet, le droit de rétractation pour simple changement d’avis peut donc ne pas s’appliquer après la commande d’un produit clairement personnalisé. La production peut commencer rapidement après confirmation du design et paiement, mais le parcours de commande doit d’abord expliquer le régime de rétractation applicable et recueillir toute reconnaissance exigée par la loi.',
          'Cela ne limite pas les droits impératifs en cas de produit erroné, endommagé, défectueux ou non conforme à sa description. Tout droit d’annulation imposé par la loi reste applicable.',
        ],
      },
      {
        heading: '6. Livraison, dommage et erreur',
        paragraphs: [
          'Le paiement final doit afficher le délai de livraison et, après vérification pour l’itinéraire concerné, les conditions de livraison ainsi que la répartition des droits de douane, taxes et frais d’importation. Un délai estimatif n’est pas une date garantie sauf accord exprès, mais cette qualification ne supprime aucun droit impératif relatif à la livraison.',
          'Pour une vente à un consommateur dans l’UE, sauf délai différent convenu, les biens doivent être livrés sans retard injustifié et au plus tard trente jours après la conclusion du contrat. Si la livraison n’intervient pas dans le délai supplémentaire raisonnable prévu par la loi, le consommateur peut mettre fin au contrat et obtenir le remboursement légalement dû. Aucun délai supplémentaire n’est requis en cas de refus de livrer ou de dépassement d’un délai essentiel convenu. D’autres marchés peuvent prévoir des droits différents ou supplémentaires.',
          'Si un article arrive endommagé, incomplet ou différent de la commande confirmée, contactez hello@pixbrik.com avec le numéro de commande et les photos ou autres informations raisonnablement disponibles. Cela facilite l’enquête, mais ne conditionne aucun recours impératif et ne réduit aucun délai légal. Pour une vente à un consommateur dans l’UE, PixBrik supporte le risque du transport jusqu’à la prise de possession physique par le client ou un tiers désigné lorsque le transporteur a été proposé ou mandaté par PixBrik. L’exception concerne le transporteur que le client a mandaté de sa propre initiative et qui n’était pas proposé par PixBrik. La solution peut inclure la réparation, le remplacement, la complétion, la réduction du prix ou le remboursement. Un avoir peut être proposé, mais ne remplacera pas sans votre accord un recours exigé par la loi.',
        ],
      },
      {
        heading: '7. Sécurité, assemblage et marques tierces',
        paragraphs: [
          'Avant toute mise en vente, PixBrik doit achever la classification du produit et l’évaluation de sécurité exigée dans chaque marché. Pour les ventes dans l’UE, les exigences applicables du règlement relatif à la sécurité générale des produits doivent être respectées. Le marquage CE n’est requis que si la législation applicable au produit classifié l’impose, notamment si le produit est qualifié de jouet ; il ne doit pas être présenté comme universel. L’âge, les avertissements sur les petites pièces, la traçabilité, les informations sur les opérateurs économiques et les dossiers de conformité requis doivent être finalisés avant la vente.',
          'PixBrik est une entreprise indépendante. LEGO est une marque du groupe LEGO, qui ne sponsorise, n’autorise ni ne recommande PixBrik. Les autres noms et marques appartiennent à leurs propriétaires respectifs.',
        ],
      },
      {
        heading: '8. Responsabilité et droits impératifs',
        paragraphs: [
          'Aucune disposition ne supprime ou ne limite une responsabilité ou un droit du consommateur lorsque la loi l’interdit, notamment pour les produits défectueux ou non conformes. Le client doit respecter les consignes de sécurité et d’assemblage et tenir les pièces soumises à une limite d’âge hors de portée des enfants plus jeunes.',
        ],
      },
      {
        heading: '9. Droit applicable et litiges',
        paragraphs: [
          'Le droit français est proposé, sans priver le consommateur des protections impératives de son pays de résidence. Contactez-nous d’abord afin de rechercher une solution. Les conditions finales devront identifier le médiateur compétent et les droits propres à chaque marché.',
        ],
      },
    ],
  },
  es: {
    counselReviewLabel: 'BORRADOR: NO APROBADO PARA PUBLICACIÓN NI PAGO',
    eyebrow: 'Legal',
    title: 'Condiciones de venta',
    subtitle: 'Propuesta de condiciones para pedidos PixBrik personalizados.',
    lastUpdatedLabel: 'Versión provisional',
    sections: [
      {
        heading: '1. Vendedor y contacto',
        paragraphs: [
          'PixBrik, 173 rue de Courcelles, 75017 París, Francia. Para consultas sobre pedidos: hello@pixbrik.com. Antes de publicar deben añadirse los datos definitivos de registro, IVA y mediación de consumo.',
        ],
      },
      {
        heading: '2. Productos personalizados y vistas previas',
        paragraphs: [
          'PixBrik transforma imágenes o archivos 3D del cliente en una propuesta de construcción con piezas. Las vistas previas son simulaciones digitales. Las diferencias causadas por pantallas, piezas, montaje y producción se limitan a las tolerancias informadas antes del pago; esto no elimina los derechos obligatorios si el kit entregado es sustancialmente distinto, defectuoso o no coincide con su descripción.',
          'Antes de comprar, el cliente debe revisar y confirmar diseño, tamaño, paleta, relleno, estimación de piezas y entrega. PixBrik suministrará esa versión confirmada por el cliente. Todo cambio que afecte sustancialmente al aspecto, las dimensiones, la paleta, el precio, el número de piezas o la posibilidad de montaje requiere una vista previa actualizada y un nuevo acuerdo antes de producir. Solo pueden aplicarse sin nuevo acuerdo las tolerancias menores informadas antes del pago.',
        ],
      },
      {
        heading: '3. Tus imágenes y permisos',
        paragraphs: [
          'Debes ser titular del contenido o tener permiso para usarlo y representar a cada persona identificable. Concedes a PixBrik y a los proveedores de servicios identificados una licencia limitada para tratar ese contenido con el fin de prestar, asistir y proteger el servicio solicitado, conforme al Aviso de privacidad.',
          'No subas material ilegal, infractor o perjudicial. Podemos rechazar o detener un pedido cuando sea razonablemente necesario para proteger a las personas, los derechos o el servicio.',
        ],
      },
      {
        heading: '4. Precio, pago y aceptación',
        paragraphs: [
          'El pago final debe mostrar el precio total, la divisa, los impuestos y el envío antes de cobrar. La confirmación del pago no supone la aceptación del pedido. El contrato se formaliza cuando PixBrik confirma que ha aceptado el pedido. Si no puede aceptarlo, debe devolver cualquier importe cobrado por el medio aplicable.',
        ],
      },
      {
        heading: '5. Cambios, desistimiento y cancelación',
        paragraphs: [
          'Cada kit se fabrica según las especificaciones del cliente. Cuando la ley lo permita, el derecho de desistimiento por cambio de opinión puede no aplicarse a un producto claramente personalizado. La producción puede comenzar poco después de que el cliente confirme el diseño y pague, pero antes el proceso de compra debe explicar el régimen de desistimiento aplicable y obtener cualquier reconocimiento exigido por ley.',
          'Esto no limita los derechos obligatorios si el producto es incorrecto, dañado, defectuoso o no coincide con su descripción. Se mantiene cualquier derecho de cancelación exigido por la ley.',
        ],
      },
      {
        heading: '6. Entrega, daños y productos incorrectos',
        paragraphs: [
          'El pago final debe mostrar el plazo de entrega y, una vez verificados para la ruta, las condiciones de entrega y la asignación de aduanas, aranceles y cargos de importación. Una fecha estimada no es una fecha garantizada salvo acuerdo expreso, pero llamarla estimada no elimina ningún derecho obligatorio de entrega.',
          'En ventas a consumidores de la UE, salvo que se acuerde otro plazo, los bienes deben entregarse sin demora indebida y como máximo treinta días después de celebrarse el contrato. Si la entrega tampoco se produce dentro del plazo adicional razonable previsto por ley, el consumidor puede resolver el contrato y recibir el reembolso legalmente exigido. No hace falta plazo adicional si el vendedor se niega a entregar o incumple un plazo esencial acordado. Otros mercados pueden conceder derechos distintos o adicionales.',
          'Si el artículo llega dañado, incompleto o distinto del pedido confirmado, escribe a hello@pixbrik.com con el número de pedido y las fotos u otra información que esté razonablemente disponible. Esto facilita la investigación, pero no condiciona ningún remedio obligatorio ni reduce plazos legales. En ventas a consumidores de la UE, PixBrik asume el riesgo del transporte hasta que el cliente o un tercero designado adquiere la posesión física cuando PixBrik ofreció o contrató al transportista. La excepción se limita al transportista no ofrecido por PixBrik que el cliente contrató de forma independiente. La solución puede incluir reparación, sustitución, finalización, reducción del precio o reembolso. Podemos ofrecer crédito, pero no sustituirá sin tu acuerdo un remedio exigido por ley.',
        ],
      },
      {
        heading: '7. Seguridad, montaje y marcas de terceros',
        paragraphs: [
          'Antes de ofrecer cualquier producto, PixBrik debe completar su clasificación y la evaluación de seguridad exigida en cada mercado. Para ventas en la UE deben cumplirse los requisitos aplicables del Reglamento General de Seguridad de los Productos. El marcado CE solo es obligatorio cuando lo exige la legislación aplicable al producto clasificado, incluido cuando el producto se clasifica como juguete; no debe presentarse como universal. La edad, las advertencias sobre piezas pequeñas, la trazabilidad, los datos de los operadores económicos y los expedientes de conformidad exigidos deben estar completos antes de la venta.',
          'PixBrik es una empresa independiente. LEGO es una marca del Grupo LEGO, que no patrocina, autoriza ni respalda PixBrik. Las demás marcas pertenecen a sus titulares.',
        ],
      },
      {
        heading: '8. Responsabilidad y derechos obligatorios',
        paragraphs: [
          'Nada en estas condiciones excluye o limita responsabilidades o derechos del consumidor cuando sea ilegal hacerlo, incluidos los relativos a productos defectuosos o no conformes. El cliente debe seguir las instrucciones de seguridad y montaje y mantener las piezas restringidas por edad fuera del alcance de niños menores.',
        ],
      },
      {
        heading: '9. Ley y controversias',
        paragraphs: [
          'Se propone la ley francesa, sin privar al consumidor de las protecciones obligatorias de su país de residencia. Contáctanos primero para buscar una solución. La versión final debe identificar el servicio de mediación y los derechos específicos de cada mercado.',
        ],
      },
    ],
  },
  it: {
    counselReviewLabel: 'BOZZA: NON APPROVATA PER PUBBLICAZIONE O CHECKOUT',
    eyebrow: 'Note legali',
    title: 'Condizioni di vendita',
    subtitle: 'Proposta di condizioni per gli ordini PixBrik personalizzati.',
    lastUpdatedLabel: 'Versione provvisoria',
    sections: [
      {
        heading: '1. Venditore e contatti',
        paragraphs: [
          'PixBrik, 173 rue de Courcelles, 75017 Parigi, Francia. Per domande sugli ordini: hello@pixbrik.com. Prima della pubblicazione devono essere inseriti i dati definitivi di registrazione, IVA e mediazione dei consumatori.',
        ],
      },
      {
        heading: '2. Prodotti personalizzati e anteprime',
        paragraphs: [
          'PixBrik trasforma immagini o file 3D forniti dal cliente in una proposta di costruzione in mattoncini. Le anteprime sono simulazioni digitali. Le differenze dovute a schermi, pezzi, montaggio e produzione sono limitate alle tolleranze comunicate prima del checkout; ciò non elimina i diritti obbligatori se il kit fornito è sostanzialmente diverso, difettoso o non conforme alla descrizione.',
          'Prima dell’ordine, il cliente deve verificare e confermare design, dimensione, palette, riempimento, stima dei pezzi e consegna. PixBrik fornirà tale versione confermata dal cliente. Una modifica che incida sostanzialmente su aspetto, dimensioni, palette, prezzo, numero di pezzi o possibilità di montaggio richiede una nuova anteprima e un nuovo accordo prima della produzione. Senza nuovo accordo possono applicarsi soltanto tolleranze minori comunicate prima del checkout.',
        ],
      },
      {
        heading: '3. Immagini e autorizzazioni',
        paragraphs: [
          'Devi possedere il contenuto caricato o avere il permesso di usarlo e di raffigurare ogni persona identificabile. Concedi a PixBrik e ai fornitori indicati una licenza limitata per trattarlo al solo fine di fornire, assistere e proteggere il servizio richiesto, secondo l’Informativa privacy.',
          'Non caricare materiale illecito, lesivo o dannoso. Possiamo rifiutare o interrompere un ordine quando ragionevolmente necessario per proteggere persone, diritti o servizio.',
        ],
      },
      {
        heading: '4. Prezzo, pagamento e accettazione',
        paragraphs: [
          'Il checkout finale deve mostrare prezzo totale, valuta, imposte e spedizione prima dell’addebito. La conferma del pagamento non equivale all’accettazione. Il contratto si forma quando PixBrik conferma di avere accettato l’ordine. Se l’ordine non può essere accettato, gli importi incassati devono essere restituiti con il metodo applicabile.',
        ],
      },
      {
        heading: '5. Modifiche, recesso e annullamento',
        paragraphs: [
          'Ogni kit è realizzato secondo le specifiche del cliente. Ove consentito dalla legge, il diritto di recesso per ripensamento potrebbe quindi non applicarsi a un prodotto chiaramente personalizzato. La produzione può iniziare subito dopo che il cliente conferma il design ed effettua il pagamento, ma il checkout deve prima spiegare il regime di recesso applicabile e acquisire ogni presa d’atto richiesta dalla legge.',
          'Ciò non limita i diritti obbligatori per beni errati, danneggiati, difettosi o non conformi alla descrizione. Resta valido ogni diritto di annullamento previsto dalla legge.',
        ],
      },
      {
        heading: '6. Consegna, danni e beni errati',
        paragraphs: [
          'Il checkout finale deve mostrare il periodo di consegna e, dopo la verifica per la tratta, i termini di consegna e l’attribuzione di dogana, dazi e oneri di importazione. Una data stimata non è garantita salvo accordo espresso, ma definirla una stima non elimina i diritti obbligatori sulla consegna.',
          'Nelle vendite ai consumatori dell’UE, salvo diverso termine concordato, i beni devono essere consegnati senza ingiustificato ritardo e comunque entro trenta giorni dalla conclusione del contratto. Se la consegna non avviene neppure entro l’ulteriore termine ragionevole previsto dalla legge, il consumatore può risolvere il contratto e ricevere il rimborso dovuto. Non serve un termine ulteriore se il venditore rifiuta la consegna o manca un termine essenziale concordato. Altri mercati possono prevedere diritti diversi o aggiuntivi.',
          'Se un articolo arriva danneggiato, incompleto o diverso dall’ordine confermato, scrivi a hello@pixbrik.com con il numero d’ordine e le foto o altre informazioni ragionevolmente disponibili. Ciò facilita la verifica, ma non condiziona alcun rimedio obbligatorio né riduce i termini legali. Nelle vendite ai consumatori dell’UE, PixBrik sopporta il rischio del trasporto fino alla presa di possesso fisica da parte del cliente o di un terzo designato quando il vettore è stato offerto o incaricato da PixBrik. L’eccezione è il vettore non offerto da PixBrik che il cliente ha incaricato autonomamente. Il rimedio può includere riparazione, sostituzione, completamento, riduzione del prezzo o rimborso. Un credito può essere offerto ma, senza il tuo consenso, non sostituirà un rimedio imposto dalla legge.',
        ],
      },
      {
        heading: '7. Sicurezza, montaggio e marchi terzi',
        paragraphs: [
          'Prima di offrire qualsiasi prodotto, PixBrik deve completarne la classificazione e la valutazione di sicurezza richiesta in ciascun mercato. Per le vendite nell’UE devono essere rispettati i requisiti applicabili del Regolamento sulla sicurezza generale dei prodotti. La marcatura CE è obbligatoria solo quando la normativa applicabile al prodotto classificato lo richiede, incluso il caso in cui sia classificato come giocattolo; non deve essere presentata come universale. Fascia d’età, avvertenze sulle piccole parti, tracciabilità, dati degli operatori economici e documentazione di conformità richiesti devono essere completi prima della vendita.',
          'PixBrik è un’impresa indipendente. LEGO è un marchio del Gruppo LEGO, che non sponsorizza, autorizza o approva PixBrik. Gli altri marchi appartengono ai rispettivi titolari.',
        ],
      },
      {
        heading: '8. Responsabilità e diritti obbligatori',
        paragraphs: [
          'Nulla esclude o limita responsabilità o diritti dei consumatori quando ciò è vietato, inclusi quelli per beni difettosi o non conformi. Il cliente deve seguire le istruzioni di sicurezza e montaggio e tenere le parti soggette a limiti di età lontano dai bambini più piccoli.',
        ],
      },
      {
        heading: '9. Legge e controversie',
        paragraphs: [
          'Si propone la legge francese, senza privare il consumatore delle tutele obbligatorie del paese di residenza. Contattaci prima per cercare una soluzione. Il testo finale deve indicare il servizio di mediazione e i diritti specifici di ogni mercato.',
        ],
      },
    ],
  },
  ar: {
    counselReviewLabel: 'مسودة — غير معتمدة للنشر أو إتمام الشراء',
    eyebrow: 'قانوني',
    title: 'شروط البيع',
    subtitle: 'مسودة الشروط المقترحة لطلبات PixBrik المخصصة.',
    lastUpdatedLabel: 'إصدار مسودة',
    sections: [
      {
        heading: '1. البائع والتواصل',
        paragraphs: [
          'PixBrik، 173 rue de Courcelles، 75017 Paris، France. للأسئلة حول الطلبات: hello@pixbrik.com. يجب إضافة بيانات التسجيل والضريبة ووسيط المستهلك النهائية قبل النشر.',
        ],
      },
      {
        heading: '2. المنتجات المخصصة والمعاينات',
        paragraphs: [
          'تحوّل PixBrik الصور أو ملفات 3D التي يقدمها العميل إلى تصميم بناء مقترح. المعاينات المعروضة محاكاة رقمية. تقتصر الفروق الناتجة عن الشاشات والقطع والتجميع والإنتاج على حدود التفاوت الموضحة قبل الدفع؛ ولا يلغي ذلك الحقوق الإلزامية إذا كان الطقم المسلم مختلفاً بصورة جوهرية أو معيباً أو غير مطابق للوصف.',
          'قبل الطلب، يجب على العميل مراجعة التصميم والحجم ولوحة الألوان ومستوى التعبئة وتقدير عدد القطع وتفاصيل التوصيل وتأكيدها. ستوفر PixBrik النسخة التي أكدها العميل. يتطلب أي تغيير يؤثر جوهرياً في الشكل أو الأبعاد أو الألوان أو السعر أو عدد القطع أو قابلية التجميع معاينة محدثة وموافقة جديدة من العميل قبل الإنتاج. لا يجوز تطبيق حدود تفاوت بسيطة دون موافقة جديدة إلا إذا كُشف عنها قبل الدفع.',
        ],
      },
      {
        heading: '3. الصور والأذونات',
        paragraphs: [
          'يجب أن تكون مالكاً للمحتوى المرفوع أو مصرحاً لك باستخدامه وبإظهار كل شخص يمكن التعرف عليه. تمنح PixBrik ومقدمي الخدمة المفصح عنهم ترخيصاً محدوداً لمعالجة المحتوى لتقديم الخدمة المطلوبة ودعمها وتأمينها، وفق إشعار الخصوصية.',
          'لا ترفع محتوى غير قانوني أو منتهك للحقوق أو ضار. قد نرفض أو نوقف طلباً عندما يكون ذلك ضرورياً بشكل معقول لحماية الأشخاص أو الحقوق أو الخدمة.',
        ],
      },
      {
        heading: '4. السعر والدفع وقبول الطلب',
        paragraphs: [
          'يجب أن تعرض صفحة الدفع النهائية السعر الإجمالي والعملة والضريبة والشحن قبل تحصيل المبلغ. إيصال الدفع لا يعني قبول الطلب. ينعقد العقد عندما تؤكد PixBrik أنها قبلت الطلب. إذا تعذر قبوله، يجب إعادة أي مبلغ محصل بوسيلة الدفع المناسبة.',
        ],
      },
      {
        heading: '5. التعديل والانسحاب والإلغاء',
        paragraphs: [
          'يُصنع كل طقم وفق مواصفات العميل. لذلك، حيث يسمح القانون، قد لا ينطبق حق العدول بسبب تغيير الرأي بعد طلب منتج مخصص بوضوح. قد يبدأ الإنتاج مباشرة بعد تأكيد العميل للتصميم والدفع، لكن يجب أولاً أن توضح صفحة الدفع نظام العدول المطبق وأن تحصل على أي إقرار يفرضه القانون.',
          'لا يحد ذلك من الحقوق الإلزامية عندما تكون السلع خاطئة أو تالفة أو معيبة أو غير مطابقة للوصف. يبقى أي حق إلغاء إلزامي مقرر بموجب القانون قائماً.',
        ],
      },
      {
        heading: '6. التوصيل والتلف والسلع الخاطئة',
        paragraphs: [
          'يجب أن تعرض صفحة الدفع النهائية مدة التوصيل، وبعد التحقق من مسار الشحن، شروط التسليم وتوزيع مسؤولية الجمارك والرسوم وتكاليف الاستيراد. الموعد التقديري ليس موعداً مضموناً إلا إذا اتُّفق عليه صراحة، لكن وصفه بالتقديري لا يلغي أي حقوق إلزامية متعلقة بالتوصيل.',
          'في المبيعات للمستهلكين في الاتحاد الأوروبي، وما لم يُتفق على مدة أخرى، يجب تسليم السلع دون تأخير غير مبرر وفي موعد أقصاه ثلاثون يوماً من إبرام العقد. إذا لم يتم التسليم خلال المهلة الإضافية المعقولة التي يقررها القانون، يجوز للمستهلك إنهاء العقد واسترداد المبلغ المستحق قانوناً. لا تُشترط مهلة إضافية إذا رفض البائع التسليم أو فات موعد أساسي متفق عليه. قد تمنح الأسواق الأخرى حقوقاً مختلفة أو إضافية.',
          'إذا وصل المنتج تالفاً أو ناقصاً أو مختلفاً عن الطلب المؤكد، تواصل مع hello@pixbrik.com وأرفق رقم الطلب وأي صور أو معلومات أخرى متاحة بصورة معقولة. يساعد ذلك في التحقيق، لكنه ليس شرطاً لأي حل إلزامي ولا يقصّر أي مدة قانونية. في المبيعات للمستهلكين في الاتحاد الأوروبي، تتحمل PixBrik مخاطر النقل حتى يتسلم العميل أو طرف ثالث عيّنه المنتج مادياً، متى كانت PixBrik قد عرضت شركة النقل أو تعاقدت معها. ويقتصر الاستثناء على شركة نقل لم تعرضها PixBrik وتعاقد معها العميل بصورة مستقلة. قد يشمل الحل الإصلاح أو الاستبدال أو الإكمال أو خفض السعر أو رد المبلغ. يمكن عرض رصيد متجر، لكنه لن يحل محل حل يفرضه القانون دون موافقتك.',
        ],
      },
      {
        heading: '7. السلامة والتجميع وعلامات الغير',
        paragraphs: [
          'قبل عرض أي منتج للبيع، يجب على PixBrik إكمال تصنيفه وتقييم السلامة المطلوب في كل سوق. بالنسبة إلى المبيعات في الاتحاد الأوروبي، يجب استيفاء المتطلبات المنطبقة من اللائحة العامة لسلامة المنتجات. لا تكون علامة CE مطلوبة إلا إذا فرضتها التشريعات المنطبقة على المنتج المصنف، بما في ذلك عند تصنيفه كلعبة، ولا يجوز عرضها على أنها مطلوبة لجميع المنتجات. يجب إكمال الفئة العمرية وتحذيرات القطع الصغيرة وبيانات التتبع ومعلومات المشغلين الاقتصاديين وسجلات المطابقة المطلوبة قبل البيع.',
          'PixBrik شركة مستقلة. LEGO علامة تجارية لمجموعة LEGO، وهي لا ترعى PixBrik ولا تصرح لها أو تؤيدها. تعود الأسماء والعلامات الأخرى لأصحابها.',
        ],
      },
      {
        heading: '8. المسؤولية والحقوق الإلزامية',
        paragraphs: [
          'لا يستبعد أي نص في هذه الشروط مسؤولية أو حقوقاً للمستهلك أو يقيدها حيث يكون ذلك غير قانوني، بما في ذلك حقوق السلع المعيبة أو غير المطابقة. يتحمل العميل مسؤولية اتباع تعليمات السلامة والتجميع وإبعاد القطع المقيدة عمرياً عن الأطفال دون العمر المحدد.',
        ],
      },
      {
        heading: '9. القانون والنزاعات',
        paragraphs: [
          'يُقترح تطبيق القانون الفرنسي، دون حرمان المستهلك من الحماية الإلزامية في بلد إقامته. تواصل معنا أولاً لنحاول حل المشكلة. يجب أن تحدد الشروط النهائية خدمة وساطة المستهلك والحقوق الخاصة بكل سوق قبل النشر.',
        ],
      },
    ],
  },
};

export const PRIVACY_COPY: Record<LegalLocale, LegalDocumentCopy> = {
  en: {
    counselReviewLabel: 'DRAFT — NOT APPROVED FOR PUBLICATION',
    eyebrow: 'Privacy',
    title: 'Privacy notice',
    subtitle: 'How PixBrik proposes to use personal data, including uploaded photos and 3D files.',
    lastUpdatedLabel: 'Draft version',
    sections: [
      {
        heading: '1. Who controls your data',
        paragraphs: [
          'PixBrik, 173 rue de Courcelles, 75017 Paris, France, is proposed as the data controller. Contact hello@pixbrik.com for privacy questions or requests. Final company and privacy contact details must be confirmed before publication.',
        ],
      },
      {
        heading: '2. Data we collect',
        paragraphs: ['Depending on how you use PixBrik, we may collect:'],
        bullets: [
          'account, contact, delivery and language information;',
          'orders, customer-confirmed designs, invoices, support history and payment references (the production application is not intended to store full card details);',
          'photos, 3D files, generated models, brick plans and related instructions;',
          'device, security, cookie, analytics, referral and affiliate information;',
          'marketing choices and communications.',
        ],
      },
      {
        heading: '3. Why we use it',
        paragraphs: [
          'The proposed purposes are to create and deliver a requested build, operate accounts and payments, provide support, prevent abuse, comply with legal duties, improve service reliability and measure performance. Before release, the actual data flows must be verified and the final notice must map each purpose to its lawful basis, such as contract, legal obligation, legitimate interests or consent.',
          'Production settings must apply the consent or other lawful choice required in the customer’s market to marketing emails and non-essential cookies. A customer must be able to change those choices without affecting service messages needed for an order.',
        ],
      },
      {
        heading: '4. Images, 3D generation and providers',
        paragraphs: [
          'Uploaded files may contain personal data and are intended to be used to generate, review, produce and support the requested build. Before release, the upload flow and processor/subprocessor inventory must accurately identify every generation and storage provider involved, its role and location, and the applicable retention settings.',
          'PixBrik’s proposed policy is not to use customer uploads to train a general PixBrik model without a separate, explicit choice. That policy and every provider’s retention, training and reuse controls must be contractually and technically verified before this statement is published.',
        ],
      },
      {
        heading: '5. Sharing and international transfers',
        paragraphs: [
          'The proposed policy is to limit sharing to what is needed by hosting, generation, payment, email, analytics, production and delivery providers, and by authorities when legally required, and not to sell personal data. Before publication, actual data flows must be audited and the final notice must list provider categories, material subprocessors and safeguards for transfers outside the EEA or the customer’s country.',
        ],
      },
      {
        heading: '6. Retention and security',
        paragraphs: [
          'The proposed retention rule is to keep data only for the period needed for the stated purpose, legal records, disputes and security. Raw uploads, generated assets, orders, invoices, support records and analytics may require different periods. Actual storage behaviour must be verified and exact periods or objective criteria added to the final retention schedule.',
          'The production service must implement access controls, private file storage, encryption in transit, monitoring and backups appropriate to the risk. These controls and provider responsibilities must be verified before publication. No system is completely secure; suspected incidents must be assessed and notified where required by law.',
        ],
      },
      {
        heading: '7. Your choices and rights',
        paragraphs: [
          'Depending on applicable law, you may request access, correction, deletion, restriction, portability or objection, and withdraw consent. Send a request to hello@pixbrik.com. We may need to verify identity and may retain information where law requires it.',
          'People in the EEA may complain to their local data-protection authority; in France this is the CNIL. Exercising a right will not affect service unfairly.',
        ],
      },
      {
        heading: '8. Children and other people in photos',
        paragraphs: [
          'The proposed launch rule is that ordering and account features are for adults. A child’s image must be submitted by a parent or authorised guardian who has authority to do so. If you submit another person’s image, you must have permission and must tell them how PixBrik will process it. The production age gate and safeguarding flow must be verified before publication.',
        ],
      },
      {
        heading: '9. Cookies and updates',
        paragraphs: [
          'The production configuration must limit essential storage to security and necessary choices and, where required, keep analytics or marketing technologies off until consent. The deployed technologies, final cookie list and controls must be verified before launch.',
          'Material changes to this notice must be dated and communicated when required. The order record must retain the version of the notice presented at checkout and the presentation timestamp. A record that the notice was presented is not consent to processing that requires a separate consent.',
        ],
      },
    ],
  },
  fr: {
    counselReviewLabel: 'PROJET — NON VALIDÉ POUR PUBLICATION',
    eyebrow: 'Confidentialité',
    title: 'Avis de confidentialité',
    subtitle: 'Utilisation proposée des données personnelles, notamment les photos et fichiers 3D transmis.',
    lastUpdatedLabel: 'Version provisoire',
    sections: [
      {
        heading: '1. Responsable du traitement',
        paragraphs: [
          'PixBrik, 173 rue de Courcelles, 75017 Paris, France, est proposé comme responsable du traitement. Pour toute question ou demande : hello@pixbrik.com. Les coordonnées définitives de la société et du contact vie privée devront être confirmées avant publication.',
        ],
      },
      {
        heading: '2. Données collectées',
        paragraphs: ['Selon votre utilisation de PixBrik, nous pouvons collecter :'],
        bullets: [
          'les informations de compte, de contact, de livraison et de langue ;',
          'les commandes, designs confirmés par le client, factures, demandes d’assistance et références de paiement (l’application de production n’est pas destinée à stocker les données complètes de carte) ;',
          'les photos, fichiers 3D, modèles générés, plans de briques et instructions ;',
          'les informations relatives à l’appareil, la sécurité, les cookies, l’audience, le parrainage et l’affiliation ;',
          'vos choix marketing et communications.',
        ],
      },
      {
        heading: '3. Finalités',
        paragraphs: [
          'Les finalités proposées sont de créer et livrer la construction demandée, gérer comptes et paiements, assister les clients, lutter contre les abus, respecter nos obligations, fiabiliser le service et mesurer sa performance. Avant mise en service, les flux réels devront être vérifiés et l’avis final devra associer chaque finalité à sa base légale : contrat, obligation légale, intérêt légitime ou consentement.',
          'La configuration de production doit appliquer aux e-mails marketing et cookies non essentiels le consentement ou l’autre choix légal requis dans le pays du client. Ce choix doit pouvoir être modifié sans bloquer les messages de service nécessaires à une commande.',
        ],
      },
      {
        heading: '4. Images, génération 3D et prestataires',
        paragraphs: [
          'Les fichiers transmis peuvent contenir des données personnelles et sont destinés à générer, vérifier, produire et assister la construction demandée. Avant mise en service, le parcours de téléversement et l’inventaire des sous-traitants et sous-traitants ultérieurs doivent identifier exactement chaque prestataire de génération et de stockage, son rôle, sa localisation et ses paramètres de conservation.',
          'La politique proposée de PixBrik est de ne pas utiliser les fichiers clients pour entraîner un modèle PixBrik général sans choix distinct et explicite. Cette politique et les contrôles de conservation, d’entraînement et de réutilisation de chaque prestataire devront être vérifiés contractuellement et techniquement avant publication.',
        ],
      },
      {
        heading: '5. Destinataires et transferts internationaux',
        paragraphs: [
          'La politique proposée est de limiter le partage aux données nécessaires aux prestataires d’hébergement, génération, paiement, e-mail, audience, production et livraison et aux autorités lorsque la loi l’exige, et de ne pas vendre les données personnelles. Avant publication, les flux réels devront être audités et l’avis final devra préciser les catégories de prestataires, les sous-traitants importants et les garanties des transferts hors EEE ou hors du pays du client.',
        ],
      },
      {
        heading: '6. Conservation et sécurité',
        paragraphs: [
          'La règle proposée est de conserver les données uniquement le temps nécessaire aux finalités, obligations légales, litiges et besoins de sécurité. Les fichiers bruts, actifs générés, commandes, factures, dossiers d’assistance et données d’audience peuvent avoir des durées différentes. Le stockage réel devra être vérifié et les durées ou critères précis devront figurer dans le calendrier final.',
          'Le service de production doit mettre en œuvre des contrôles d’accès, un stockage privé, le chiffrement en transit, la surveillance et des sauvegardes adaptés aux risques. Ces contrôles et les responsabilités des prestataires doivent être vérifiés avant publication. Aucun système n’est totalement sûr ; les incidents suspectés doivent être évalués et notifiés lorsque la loi l’impose.',
        ],
      },
      {
        heading: '7. Vos choix et vos droits',
        paragraphs: [
          'Selon la loi applicable, vous pouvez demander l’accès, la rectification, l’effacement, la limitation, la portabilité ou l’opposition, et retirer un consentement. Écrivez à hello@pixbrik.com. Une vérification d’identité peut être nécessaire et certaines données peuvent être conservées lorsque la loi l’exige.',
          'Dans l’EEE, vous pouvez saisir votre autorité locale de protection des données ; en France, il s’agit de la CNIL. L’exercice d’un droit ne donnera lieu à aucun traitement défavorable.',
        ],
      },
      {
        heading: '8. Enfants et autres personnes photographiées',
        paragraphs: [
          'La règle de lancement proposée réserve les comptes et commandes aux adultes. L’image d’un enfant doit être transmise par un parent ou représentant autorisé. Pour l’image d’un tiers, vous devez avoir son autorisation et l’informer du traitement par PixBrik. Le contrôle d’âge et le parcours de protection déployés devront être vérifiés avant publication.',
        ],
      },
      {
        heading: '9. Cookies et mises à jour',
        paragraphs: [
          'La configuration de production doit limiter le stockage essentiel à la sécurité et aux choix nécessaires et, lorsque la loi l’exige, laisser les technologies d’audience ou marketing désactivées jusqu’au consentement. Les technologies déployées, la liste et les contrôles finaux des cookies devront être vérifiés avant lancement.',
          'Toute modification importante devra être datée et signalée lorsque nécessaire. Le dossier de commande doit conserver la version de l’avis présentée lors du paiement et l’horodatage de cette présentation. La preuve de présentation d’un avis de confidentialité ne vaut pas consentement à un traitement qui exige un consentement distinct.',
        ],
      },
    ],
  },
  es: {
    counselReviewLabel: 'BORRADOR: NO APROBADO PARA PUBLICACIÓN',
    eyebrow: 'Privacidad',
    title: 'Aviso de privacidad',
    subtitle: 'Cómo propone PixBrik utilizar datos personales, incluidas fotos y archivos 3D.',
    lastUpdatedLabel: 'Versión provisional',
    sections: [
      {
        heading: '1. Responsable de tus datos',
        paragraphs: [
          'Se propone como responsable a PixBrik, 173 rue de Courcelles, 75017 París, Francia. Para preguntas o solicitudes de privacidad: hello@pixbrik.com. Los datos definitivos de la empresa y del contacto de privacidad deben confirmarse antes de publicar.',
        ],
      },
      {
        heading: '2. Datos que recopilamos',
        paragraphs: ['Según cómo uses PixBrik, podemos recopilar:'],
        bullets: [
          'datos de cuenta, contacto, entrega e idioma;',
          'pedidos, diseños confirmados por el cliente, facturas, soporte y referencias de pago (la aplicación de producción no está prevista para almacenar los datos completos de tarjeta);',
          'fotos, archivos 3D, modelos generados, planos de piezas e instrucciones;',
          'datos de dispositivo, seguridad, cookies, analítica, referidos y afiliación;',
          'preferencias de marketing y comunicaciones.',
        ],
      },
      {
        heading: '3. Para qué los usamos',
        paragraphs: [
          'Las finalidades propuestas son crear y entregar la construcción, operar cuentas y pagos, prestar soporte, prevenir abusos, cumplir obligaciones, mejorar la fiabilidad y medir el servicio. Antes de la puesta en servicio deben verificarse los flujos reales y el aviso final debe vincular cada finalidad con su base jurídica: contrato, obligación legal, interés legítimo o consentimiento.',
          'La configuración de producción debe aplicar a los correos de marketing y cookies no esenciales el consentimiento u otra opción legal exigida en el mercado del cliente. El cliente debe poder cambiarla sin dejar de recibir mensajes necesarios para un pedido.',
        ],
      },
      {
        heading: '4. Imágenes, generación 3D y proveedores',
        paragraphs: [
          'Los archivos subidos pueden contener datos personales y están destinados a generar, revisar, producir y asistir la construcción solicitada. Antes de la puesta en servicio, el flujo de carga y el inventario de encargados y subencargados del tratamiento deben identificar con exactitud a cada proveedor de generación y almacenamiento, su función, ubicación y configuración de conservación.',
          'La política propuesta de PixBrik es no usar archivos de clientes para entrenar un modelo general de PixBrik sin una elección separada y explícita. Esa política y los controles de conservación, entrenamiento y reutilización de cada proveedor deben verificarse contractual y técnicamente antes de publicar esta afirmación.',
        ],
      },
      {
        heading: '5. Destinatarios y transferencias',
        paragraphs: [
          'La política propuesta es limitar el intercambio a lo necesario para los proveedores de alojamiento, generación, pago, correo, analítica, producción y entrega y para las autoridades cuando lo exija la ley, y no vender datos personales. Antes de publicar deben auditarse los flujos reales y el aviso final debe identificar categorías de proveedores, encargados del tratamiento relevantes y salvaguardas para transferencias fuera del EEE o del país del cliente.',
        ],
      },
      {
        heading: '6. Conservación y seguridad',
        paragraphs: [
          'La regla propuesta es conservar los datos solo durante el tiempo necesario para la finalidad, los registros legales, las disputas y la seguridad. Archivos originales, activos generados, pedidos, facturas, soporte y analítica pueden tener plazos distintos. Debe verificarse el almacenamiento real y el calendario final debe indicar plazos o criterios objetivos.',
          'El servicio de producción debe aplicar controles de acceso, almacenamiento privado, cifrado en tránsito, supervisión y copias de seguridad adecuados al riesgo. Estos controles y las responsabilidades de los proveedores deben verificarse antes de publicar. Ningún sistema es completamente seguro; los incidentes sospechosos deben evaluarse y notificarse cuando la ley lo exija.',
        ],
      },
      {
        heading: '7. Tus opciones y derechos',
        paragraphs: [
          'Según la ley, puedes solicitar acceso, rectificación, supresión, limitación, portabilidad u oposición, y retirar el consentimiento. Escribe a hello@pixbrik.com. Podemos verificar la identidad y conservar información cuando la ley lo exija.',
          'En el EEE puedes reclamar ante tu autoridad de protección de datos; en Francia es la CNIL. Ejercer un derecho no afectará injustamente al servicio.',
        ],
      },
      {
        heading: '8. Menores y otras personas en las fotos',
        paragraphs: [
          'La regla de lanzamiento propuesta reserva las cuentas y pedidos a adultos. La imagen de un menor debe enviarla un progenitor o tutor autorizado. Para la imagen de otra persona, debes tener permiso e informarle del tratamiento por PixBrik. El control de edad y el flujo de protección desplegados deben verificarse antes de publicar.',
        ],
      },
      {
        heading: '9. Cookies y cambios',
        paragraphs: [
          'La configuración de producción debe limitar el almacenamiento esencial a la seguridad y las opciones necesarias y, cuando sea obligatorio, mantener desactivadas la analítica o el marketing hasta el consentimiento. Las tecnologías desplegadas y la lista y controles de cookies deben verificarse antes del lanzamiento.',
          'Los cambios importantes deben fecharse y comunicarse cuando corresponda. El registro del pedido debe conservar la versión del aviso presentada al pagar y la marca de tiempo de esa presentación. Registrar que se presentó un aviso de privacidad no equivale al consentimiento para un tratamiento que requiera consentimiento separado.',
        ],
      },
    ],
  },
  it: {
    counselReviewLabel: 'BOZZA: NON APPROVATA PER LA PUBBLICAZIONE',
    eyebrow: 'Privacy',
    title: 'Informativa privacy',
    subtitle: 'Come PixBrik propone di usare i dati personali, comprese foto e file 3D.',
    lastUpdatedLabel: 'Versione provvisoria',
    sections: [
      {
        heading: '1. Titolare del trattamento',
        paragraphs: [
          'Si propone PixBrik, 173 rue de Courcelles, 75017 Parigi, Francia, come titolare. Per domande o richieste privacy: hello@pixbrik.com. I dati definitivi della società e del contatto privacy devono essere confermati prima della pubblicazione.',
        ],
      },
      {
        heading: '2. Dati raccolti',
        paragraphs: ['A seconda dell’uso di PixBrik, possiamo raccogliere:'],
        bullets: [
          'dati di account, contatto, consegna e lingua;',
          'ordini, design confermati dal cliente, fatture, assistenza e riferimenti di pagamento (l’applicazione di produzione non è destinata a conservare i dati completi della carta);',
          'foto, file 3D, modelli generati, piani dei pezzi e istruzioni;',
          'dati di dispositivo, sicurezza, cookie, analisi, referral e affiliazione;',
          'preferenze marketing e comunicazioni.',
        ],
      },
      {
        heading: '3. Finalità',
        paragraphs: [
          'Le finalità proposte sono creare e consegnare la costruzione, gestire account e pagamenti, fornire assistenza, prevenire abusi, rispettare obblighi, migliorare l’affidabilità e misurare il servizio. Prima della messa in produzione devono essere verificati i flussi reali e l’informativa finale deve associare ogni finalità alla base giuridica: contratto, obbligo legale, interesse legittimo o consenso.',
          'La configurazione di produzione deve applicare alle email marketing e ai cookie non essenziali il consenso o l’altra scelta legittima richiesta nel mercato del cliente. Il cliente deve poter cambiare la scelta senza bloccare i messaggi necessari per l’ordine.',
        ],
      },
      {
        heading: '4. Immagini, generazione 3D e fornitori',
        paragraphs: [
          'I file caricati possono contenere dati personali e sono destinati a generare, verificare, produrre e assistere la costruzione richiesta. Prima della messa in produzione, il flusso di caricamento e l’inventario dei responsabili e sub-responsabili del trattamento devono identificare con precisione ogni fornitore di generazione e archiviazione, il suo ruolo, la sua ubicazione e le impostazioni di conservazione.',
          'La politica proposta da PixBrik è di non usare i file dei clienti per addestrare un modello PixBrik generale senza una scelta separata ed esplicita. Tale politica e i controlli di conservazione, addestramento e riutilizzo di ogni fornitore devono essere verificati contrattualmente e tecnicamente prima della pubblicazione.',
        ],
      },
      {
        heading: '5. Condivisione e trasferimenti',
        paragraphs: [
          'La politica proposta è di limitare la condivisione a quanto necessario per i fornitori di hosting, generazione, pagamento, email, analisi, produzione e consegna e per le autorità quando richiesto dalla legge, e di non vendere dati personali. Prima della pubblicazione devono essere verificati i flussi reali e l’informativa finale deve indicare le categorie di fornitori, i responsabili del trattamento rilevanti e le garanzie per trasferimenti fuori dal SEE o dal paese del cliente.',
        ],
      },
      {
        heading: '6. Conservazione e sicurezza',
        paragraphs: [
          'La regola proposta è conservare i dati solo per il tempo necessario alla finalità, agli obblighi legali, alle controversie e alla sicurezza. File originali, risorse generate, ordini, fatture, assistenza e analisi possono avere periodi diversi. L’archiviazione effettiva deve essere verificata e il calendario finale dovrà indicare periodi o criteri oggettivi.',
          'Il servizio di produzione deve implementare controlli di accesso, archiviazione privata, cifratura in transito, monitoraggio e backup adeguati al rischio. Questi controlli e le responsabilità dei fornitori devono essere verificati prima della pubblicazione. Nessun sistema è completamente sicuro; gli incidenti sospetti devono essere valutati e notificati quando previsto dalla legge.',
        ],
      },
      {
        heading: '7. Scelte e diritti',
        paragraphs: [
          'Secondo la legge applicabile, puoi chiedere accesso, rettifica, cancellazione, limitazione, portabilità o opposizione e revocare il consenso. Scrivi a hello@pixbrik.com. Potremmo verificare l’identità e conservare dati quando richiesto dalla legge.',
          'Nel SEE puoi presentare reclamo all’autorità locale; in Francia è la CNIL. L’esercizio di un diritto non comporterà trattamenti ingiusti.',
        ],
      },
      {
        heading: '8. Minori e altre persone nelle foto',
        paragraphs: [
          'La regola di lancio proposta riserva account e ordini agli adulti. L’immagine di un minore deve essere inviata da un genitore o tutore autorizzato. Per l’immagine di un’altra persona devi avere il permesso e informarla del trattamento PixBrik. Il controllo dell’età e il flusso di tutela distribuiti devono essere verificati prima della pubblicazione.',
        ],
      },
      {
        heading: '9. Cookie e aggiornamenti',
        paragraphs: [
          'La configurazione di produzione deve limitare l’archiviazione essenziale alla sicurezza e alle scelte necessarie e, ove richiesto, mantenere analisi o marketing disattivati fino al consenso. Le tecnologie distribuite e l’elenco e i controlli finali dei cookie devono essere verificati prima del lancio.',
          'Le modifiche importanti devono essere datate e comunicate quando necessario. Il registro dell’ordine deve conservare la versione dell’informativa presentata al checkout e la marca temporale di tale presentazione. Registrare la presentazione di un’informativa privacy non equivale al consenso per un trattamento che richiede un consenso separato.',
        ],
      },
    ],
  },
  ar: {
    counselReviewLabel: 'مسودة — غير معتمدة للنشر',
    eyebrow: 'الخصوصية',
    title: 'إشعار الخصوصية',
    subtitle: 'كيف تقترح PixBrik استخدام البيانات الشخصية، بما فيها الصور وملفات 3D.',
    lastUpdatedLabel: 'إصدار مسودة',
    sections: [
      {
        heading: '1. مسؤول التحكم في البيانات',
        paragraphs: [
          'يُقترح أن تكون PixBrik، 173 rue de Courcelles، 75017 Paris، France، مسؤولة عن البيانات. لأسئلة أو طلبات الخصوصية: hello@pixbrik.com. يجب تأكيد بيانات الشركة وجهة الاتصال النهائية قبل النشر.',
        ],
      },
      {
        heading: '2. البيانات التي نجمعها',
        paragraphs: ['حسب استخدامك لـ PixBrik، قد نجمع:'],
        bullets: [
          'بيانات الحساب والتواصل والتسليم واللغة؛',
          'الطلبات والتصاميم التي أكدها العميل والفواتير وسجل الدعم ومراجع الدفع (ولا يُقصد بتطبيق الإنتاج تخزين بيانات البطاقة الكاملة)؛',
          'الصور وملفات 3D والنماذج المولدة وخطط القطع والتعليمات؛',
          'بيانات الجهاز والأمان وملفات تعريف الارتباط والتحليلات والإحالات والشراكات؛',
          'خيارات التسويق والمراسلات.',
        ],
      },
      {
        heading: '3. أسباب الاستخدام',
        paragraphs: [
          'تتمثل الأغراض المقترحة في إنشاء وتسليم البناء المطلوب، وإدارة الحسابات والدفعات، وتقديم الدعم، ومنع إساءة الاستخدام، والالتزام بالواجبات القانونية، وتحسين موثوقية الخدمة وقياسها. يجب قبل التشغيل التحقق من تدفقات البيانات الفعلية، كما يجب أن يربط الإشعار النهائي كل غرض بأساسه القانوني، مثل العقد أو الالتزام القانوني أو المصلحة المشروعة أو الموافقة.',
          'يجب أن تطبق إعدادات الإنتاج على رسائل التسويق وملفات تعريف الارتباط غير الضرورية الموافقة أو الخيار القانوني الآخر المطلوب في سوق العميل. ويجب أن يتمكن العميل من تغيير خياره دون إيقاف رسائل الخدمة اللازمة لطلبه.',
        ],
      },
      {
        heading: '4. الصور والتوليد ثلاثي الأبعاد ومقدمو الخدمة',
        paragraphs: [
          'قد تحتوي الملفات المرفوعة على بيانات شخصية، ويُقصد استخدامها لتوليد البناء المطلوب ومراجعته وإنتاجه ودعمه. يجب قبل التشغيل أن تحدد عملية الرفع وقائمة معالجي البيانات والمعالجين الفرعيين بدقة كل مقدم لخدمات التوليد والتخزين ودوره وموقعه وإعدادات الاحتفاظ لديه.',
          'تقضي سياسة PixBrik المقترحة بعدم استخدام ملفات العملاء لتدريب نموذج PixBrik عام دون خيار منفصل وصريح. يجب التحقق تعاقدياً وتقنياً من هذه السياسة ومن ضوابط الاحتفاظ والتدريب وإعادة الاستخدام لدى كل مقدم خدمة قبل نشر هذا النص.',
        ],
      },
      {
        heading: '5. المشاركة والنقل الدولي',
        paragraphs: [
          'تقضي السياسة المقترحة بقصر المشاركة على ما يحتاج إليه مقدمو خدمات الاستضافة والتوليد والدفع والبريد والتحليلات والإنتاج والتوصيل، وما تطلبه السلطات بموجب القانون، وبعدم بيع البيانات الشخصية. يجب قبل النشر تدقيق التدفقات الفعلية، كما يجب أن يحدد الإشعار النهائي فئات مقدمي الخدمة ومعالجي البيانات الرئيسيين وضمانات النقل خارج المنطقة الاقتصادية الأوروبية أو بلد العميل.',
        ],
      },
      {
        heading: '6. الاحتفاظ والأمان',
        paragraphs: [
          'تقضي قاعدة الاحتفاظ المقترحة بعدم الاحتفاظ بالبيانات إلا للمدة اللازمة للغرض المعلن والسجلات القانونية والنزاعات والأمان. قد تختلف المدد للملفات الأصلية والأصول المولدة والطلبات والفواتير والدعم والتحليلات. يجب التحقق من التخزين الفعلي وإضافة المدد الدقيقة أو المعايير الموضوعية إلى جدول الاحتفاظ النهائي.',
          'يجب أن تطبق خدمة الإنتاج ضوابط الوصول والتخزين الخاص والتشفير أثناء النقل والمراقبة والنسخ الاحتياطي بما يناسب المخاطر. ويجب التحقق من هذه الضوابط ومسؤوليات مقدمي الخدمة قبل النشر. لا يوجد نظام آمن تماماً؛ ويجب تقييم الحوادث المشتبه بها والإبلاغ عنها عندما يطلب القانون.',
        ],
      },
      {
        heading: '7. خياراتك وحقوقك',
        paragraphs: [
          'حسب القانون، قد يكون لك الحق في طلب الوصول أو التصحيح أو الحذف أو التقييد أو النقل أو الاعتراض، وسحب الموافقة. أرسل الطلب إلى hello@pixbrik.com. قد نحتاج إلى التحقق من الهوية وقد نحتفظ بمعلومات يطلبها القانون.',
          'يمكن للأشخاص في المنطقة الاقتصادية الأوروبية الشكوى لدى هيئة حماية البيانات المحلية؛ في فرنسا هي CNIL. لن يؤدي ممارسة الحق إلى معاملة غير عادلة.',
        ],
      },
      {
        heading: '8. الأطفال والأشخاص الآخرون في الصور',
        paragraphs: [
          'تقضي قاعدة الإطلاق المقترحة بقصر خصائص الحساب والطلب على البالغين. يجب أن يرفع صورة الطفل والد أو وصي مصرح له. إذا رفعت صورة شخص آخر، يجب أن يكون لديك إذنه وأن تخبره بكيفية معالجة PixBrik للصورة. يجب التحقق قبل النشر من آلية التحقق من العمر ومسار الحماية المستخدمين فعلياً.',
        ],
      },
      {
        heading: '9. ملفات تعريف الارتباط والتحديثات',
        paragraphs: [
          'يجب أن تقصر إعدادات الإنتاج التخزين الضروري على الأمان والخيارات اللازمة، وأن تُبقي تقنيات التحليل أو التسويق متوقفة حتى الموافقة حيث يلزم. ويجب التحقق من التقنيات المستخدمة فعلياً ومن قائمة ملفات تعريف الارتباط وأدوات التحكم قبل الإطلاق.',
          'يجب تأريخ التغييرات المهمة والإبلاغ عنها عند الضرورة. يجب أن يحتفظ سجل الطلب بنسخة الإشعار التي عُرضت عند الدفع والطابع الزمني لعرضها. تسجيل عرض إشعار الخصوصية لا يُعد موافقة على معالجة تتطلب موافقة منفصلة.',
        ],
      },
    ],
  },
};

export const CONTACT_COPY: Record<LegalLocale, ContactCopy> = {
  en: {
    eyebrow: 'Help',
    title: 'Contact PixBrik',
    subtitle: 'Send a question to hello@pixbrik.com. Include an order number when your message concerns a purchase.',
    directEmailLabel: 'Messages are delivered to hello@pixbrik.com',
    nameLabel: 'Name',
    emailLabel: 'Email',
    orderLabel: 'Order number (optional)',
    topicLabel: 'What can we help with?',
    messageLabel: 'Message',
    sendLabel: 'Send message',
    sendingLabel: 'Sending…',
    sentMessage: 'Thank you. Your message has been sent.',
    sendErrorMessage: 'We could not send your message. Please try again or email hello@pixbrik.com.',
    requiredMessage: 'Enter your name, a valid email address and a message of 20–5,000 characters, then review the privacy note. An optional order number may contain only letters, numbers, spaces, hyphens and underscores.',
    invalidEmailMessage: 'Please enter a valid email address.',
    invalidNameMessage: 'Please enter your name (up to 100 characters).',
    invalidOrderMessage: 'Use only letters, numbers, spaces, hyphens or underscores in the optional order number.',
    messageLengthHelp: '20–5,000 characters',
    messageLengthMessage: 'Please enter a message between 20 and 5,000 characters.',
    privacyNoticeErrorMessage: 'We could not confirm the current privacy notice. Please review the privacy note and send again.',
    formPrivacyNote: 'We use this information to answer your request and keep a support record. Do not include card details or sensitive images in this form.',
    topics: {
      order: 'Order question',
      'wrong-damaged': 'Wrong or damaged order',
      privacy: 'Privacy request',
      billing: 'Billing or invoice',
      other: 'Something else',
    },
  },
  fr: {
    eyebrow: 'Aide',
    title: 'Contacter PixBrik',
    subtitle: 'Envoyez votre question à hello@pixbrik.com. Indiquez le numéro de commande si votre message concerne un achat.',
    directEmailLabel: 'Les messages sont transmis à hello@pixbrik.com',
    nameLabel: 'Nom',
    emailLabel: 'E-mail',
    orderLabel: 'Numéro de commande (facultatif)',
    topicLabel: 'Comment pouvons-nous vous aider ?',
    messageLabel: 'Message',
    sendLabel: 'Envoyer le message',
    sendingLabel: 'Envoi…',
    sentMessage: 'Merci. Votre message a bien été envoyé.',
    sendErrorMessage: 'Le message n’a pas pu être envoyé. Réessayez ou écrivez à hello@pixbrik.com.',
    requiredMessage: 'Indiquez votre nom, une adresse e-mail valide et un message de 20 à 5 000 caractères, puis lisez la note de confidentialité. Le numéro de commande facultatif ne peut contenir que des lettres, chiffres, espaces, tirets et traits de soulignement.',
    invalidEmailMessage: 'Saisissez une adresse e-mail valide.',
    invalidNameMessage: 'Indiquez votre nom (100 caractères maximum).',
    invalidOrderMessage: 'Le numéro de commande facultatif ne peut contenir que des lettres, chiffres, espaces, tirets ou traits de soulignement.',
    messageLengthHelp: '20 à 5 000 caractères',
    messageLengthMessage: 'Saisissez un message de 20 à 5 000 caractères.',
    privacyNoticeErrorMessage: 'La notice de confidentialité actuelle n’a pas pu être confirmée. Relisez la note de confidentialité, puis renvoyez le message.',
    formPrivacyNote: 'Ces informations servent à répondre à votre demande et à conserver son suivi. Ne transmettez pas de données de carte ou d’images sensibles dans ce formulaire.',
    topics: {
      order: 'Question sur une commande',
      'wrong-damaged': 'Commande erronée ou endommagée',
      privacy: 'Demande vie privée',
      billing: 'Facturation ou facture',
      other: 'Autre demande',
    },
  },
  es: {
    eyebrow: 'Ayuda',
    title: 'Contactar con PixBrik',
    subtitle: 'Envía tu consulta a hello@pixbrik.com. Incluye el número de pedido si se refiere a una compra.',
    directEmailLabel: 'Los mensajes se envían a hello@pixbrik.com',
    nameLabel: 'Nombre',
    emailLabel: 'Correo electrónico',
    orderLabel: 'Número de pedido (opcional)',
    topicLabel: '¿En qué podemos ayudarte?',
    messageLabel: 'Mensaje',
    sendLabel: 'Enviar mensaje',
    sendingLabel: 'Enviando…',
    sentMessage: 'Gracias. Tu mensaje se ha enviado.',
    sendErrorMessage: 'No pudimos enviar el mensaje. Inténtalo de nuevo o escribe a hello@pixbrik.com.',
    requiredMessage: 'Introduce tu nombre, un correo válido y un mensaje de entre 20 y 5.000 caracteres; después, revisa la nota de privacidad. El número de pedido opcional solo puede contener letras, números, espacios, guiones y guiones bajos.',
    invalidEmailMessage: 'Introduce un correo electrónico válido.',
    invalidNameMessage: 'Introduce tu nombre (100 caracteres como máximo).',
    invalidOrderMessage: 'El número de pedido opcional solo puede contener letras, números, espacios, guiones o guiones bajos.',
    messageLengthHelp: 'Entre 20 y 5.000 caracteres',
    messageLengthMessage: 'Escribe un mensaje de entre 20 y 5.000 caracteres.',
    privacyNoticeErrorMessage: 'No pudimos confirmar el aviso de privacidad actual. Revisa la nota de privacidad y vuelve a enviar el mensaje.',
    formPrivacyNote: 'Usamos estos datos para responder y conservar un registro de soporte. No incluyas datos de tarjeta ni imágenes sensibles.',
    topics: {
      order: 'Consulta de pedido',
      'wrong-damaged': 'Pedido erróneo o dañado',
      privacy: 'Solicitud de privacidad',
      billing: 'Facturación o factura',
      other: 'Otro asunto',
    },
  },
  it: {
    eyebrow: 'Aiuto',
    title: 'Contatta PixBrik',
    subtitle: 'Invia la domanda a hello@pixbrik.com. Includi il numero d’ordine se il messaggio riguarda un acquisto.',
    directEmailLabel: 'I messaggi vengono inviati a hello@pixbrik.com',
    nameLabel: 'Nome',
    emailLabel: 'Email',
    orderLabel: 'Numero d’ordine (facoltativo)',
    topicLabel: 'Come possiamo aiutarti?',
    messageLabel: 'Messaggio',
    sendLabel: 'Invia messaggio',
    sendingLabel: 'Invio…',
    sentMessage: 'Grazie. Il messaggio è stato inviato.',
    sendErrorMessage: 'Non è stato possibile inviare il messaggio. Riprova o scrivi a hello@pixbrik.com.',
    requiredMessage: 'Inserisci il nome, un indirizzo email valido e un messaggio da 20 a 5.000 caratteri, poi leggi la nota sulla privacy. Il numero d’ordine facoltativo può contenere solo lettere, numeri, spazi, trattini e trattini bassi.',
    invalidEmailMessage: 'Inserisci un indirizzo email valido.',
    invalidNameMessage: 'Inserisci il nome (massimo 100 caratteri).',
    invalidOrderMessage: 'Il numero d’ordine facoltativo può contenere solo lettere, numeri, spazi, trattini o trattini bassi.',
    messageLengthHelp: 'Da 20 a 5.000 caratteri',
    messageLengthMessage: 'Inserisci un messaggio da 20 a 5.000 caratteri.',
    privacyNoticeErrorMessage: 'Non è stato possibile confermare l’informativa privacy attuale. Leggi la nota sulla privacy e invia nuovamente il messaggio.',
    formPrivacyNote: 'Usiamo questi dati per rispondere e conservare una registrazione dell’assistenza. Non inserire dati della carta o immagini sensibili.',
    topics: {
      order: 'Domanda sull’ordine',
      'wrong-damaged': 'Ordine errato o danneggiato',
      privacy: 'Richiesta privacy',
      billing: 'Pagamento o fattura',
      other: 'Altro',
    },
  },
  ar: {
    eyebrow: 'المساعدة',
    title: 'تواصل مع PixBrik',
    subtitle: 'أرسل سؤالك إلى hello@pixbrik.com. أضف رقم الطلب إذا كانت رسالتك متعلقة بعملية شراء.',
    directEmailLabel: 'تُرسل الرسائل إلى hello@pixbrik.com',
    nameLabel: 'الاسم',
    emailLabel: 'البريد الإلكتروني',
    orderLabel: 'رقم الطلب (اختياري)',
    topicLabel: 'كيف يمكننا مساعدتك؟',
    messageLabel: 'الرسالة',
    sendLabel: 'إرسال الرسالة',
    sendingLabel: 'جارٍ الإرسال…',
    sentMessage: 'شكراً. تم إرسال رسالتك.',
    sendErrorMessage: 'تعذر إرسال رسالتك. حاول مرة أخرى أو اكتب إلى hello@pixbrik.com.',
    requiredMessage: 'أدخل اسمك وبريداً إلكترونياً صحيحاً ورسالة من 20 إلى 5,000 حرف، ثم راجع ملاحظة الخصوصية. يمكن أن يحتوي رقم الطلب الاختياري على حروف وأرقام ومسافات وواصلات وشرطات سفلية فقط.',
    invalidEmailMessage: 'يرجى إدخال بريد إلكتروني صحيح.',
    invalidNameMessage: 'يرجى إدخال اسمك (100 حرف كحد أقصى).',
    invalidOrderMessage: 'يمكن أن يحتوي رقم الطلب الاختياري على حروف وأرقام ومسافات وواصلات أو شرطات سفلية فقط.',
    messageLengthHelp: 'من 20 إلى 5,000 حرف',
    messageLengthMessage: 'يرجى إدخال رسالة من 20 إلى 5,000 حرف.',
    privacyNoticeErrorMessage: 'تعذر تأكيد إشعار الخصوصية الحالي. راجع ملاحظة الخصوصية ثم أرسل الرسالة مرة أخرى.',
    formPrivacyNote: 'نستخدم هذه المعلومات للرد على طلبك وحفظ سجل الدعم. لا تضف بيانات البطاقة أو صوراً حساسة.',
    topics: {
      order: 'سؤال عن طلب',
      'wrong-damaged': 'طلب خاطئ أو تالف',
      privacy: 'طلب خصوصية',
      billing: 'الدفع أو الفاتورة',
      other: 'موضوع آخر',
    },
  },
};
