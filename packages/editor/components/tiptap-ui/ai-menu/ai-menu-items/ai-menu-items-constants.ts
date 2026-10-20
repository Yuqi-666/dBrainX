// SPDX-License-Identifier: AGPL-3.0-only

import { translate } from "@workspace/ui/lib/i18n/runtime";
import type { Language } from "@workspace/editor/lib/ai";

export const SUPPORTED_LANGUAGES: Array<{
  label: string;
  value: Language;
}> = [
  {
    get label() {
      return translate("English");
    },
    value: "en",
  },
  {
    get label() {
      return translate("Korean");
    },
    value: "ko",
  },
  {
    get label() {
      return translate("Chinese");
    },
    value: "zh",
  },
  {
    get label() {
      return translate("Japanese");
    },
    value: "ja",
  },
  {
    get label() {
      return translate("Spanish");
    },
    value: "es",
  },
  {
    get label() {
      return translate("Russian");
    },
    value: "ru",
  },
  {
    get label() {
      return translate("French");
    },
    value: "fr",
  },
  {
    get label() {
      return translate("Portuguese");
    },
    value: "pt",
  },
  {
    get label() {
      return translate("German");
    },
    value: "de",
  },
  {
    get label() {
      return translate("Italian");
    },
    value: "it",
  },
  {
    get label() {
      return translate("Dutch");
    },
    value: "nl",
  },
  {
    get label() {
      return translate("Indonesian");
    },
    value: "id",
  },
  {
    get label() {
      return translate("Vietnamese");
    },
    value: "vi",
  },
  {
    get label() {
      return translate("Turkish");
    },
    value: "tr",
  },
  {
    get label() {
      return translate("Arabic");
    },
    value: "ar",
  },
];

export const SUPPORTED_TONES: Array<{ label: string; value: string }> = [
  {
    get label() {
      return translate("Academic");
    },
    value: "academic",
  },
  {
    get label() {
      return translate("Business");
    },
    value: "business",
  },
  {
    get label() {
      return translate("Casual");
    },
    value: "casual",
  },
  {
    get label() {
      return translate("Childfriendly");
    },
    value: "childfriendly",
  },
  {
    get label() {
      return translate("Confident");
    },
    value: "confident",
  },
  {
    get label() {
      return translate("Conversational");
    },
    value: "conversational",
  },
  {
    get label() {
      return translate("Creative");
    },
    value: "creative",
  },
  {
    get label() {
      return translate("Emotional");
    },
    value: "emotional",
  },
  {
    get label() {
      return translate("Excited");
    },
    value: "excited",
  },
  {
    get label() {
      return translate("Formal");
    },
    value: "formal",
  },
  {
    get label() {
      return translate("Friendly");
    },
    value: "friendly",
  },
  {
    get label() {
      return translate("Funny");
    },
    value: "funny",
  },
  {
    get label() {
      return translate("Numorous");
    },
    value: "humorous",
  },
  {
    get label() {
      return translate("Informative");
    },
    value: "informative",
  },
  {
    get label() {
      return translate("Inspirational");
    },
    value: "inspirational",
  },
  {
    get label() {
      return translate("Memeify");
    },
    value: "memeify",
  },
  {
    get label() {
      return translate("Narrative");
    },
    value: "narrative",
  },
  {
    get label() {
      return translate("Objective");
    },
    value: "objective",
  },
  {
    get label() {
      return translate("Persuasive");
    },
    value: "persuasive",
  },
  {
    get label() {
      return translate("Poetic");
    },
    value: "poetic",
  },
];
