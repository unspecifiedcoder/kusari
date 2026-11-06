---
name: Kusari
description: A dark product workspace for AI trading authority and policy.
colors:
  primary: "#a6e3c2"
  primary-hover: "#bdf2d5"
  primary-active: "#89cba7"
  primary-ink: "#102219"
  canvas: "#101216"
  navigation: "#14171c"
  surface: "#171a20"
  surface-raised: "#20242c"
  option-ground: "#1b1f26"
  rule: "#303640"
  foreground: "#f0f2f6"
  muted: "#acb4c3"
  selected-ground: "#21342c"
  selected-rule: "#8ccda9"
  warning: "#f0d49a"
  owner-action: "#f1bdc6"
typography:
  headline:
    fontFamily: "Instrument Sans, Segoe UI, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Instrument Sans, Segoe UI, sans-serif"
    fontSize: "21px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Instrument Sans, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Instrument Sans, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
  data:
    fontFamily: "Cascadia Code, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  control: "8px"
  action: "9px"
  option: "10px"
  identity: "12px"
  policy: "14px"
  workspace: "16px"
spacing:
  tight: "8px"
  compact: "12px"
  small: "16px"
  medium: "20px"
  panel: "24px"
  section: "28px"
  wide: "32px"
  canvas: "40px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.action}"
    padding: "12px 21px"
    height: "46px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.action}"
  button-primary-active:
    backgroundColor: "{colors.primary-active}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.action}"
  button-owner:
    textColor: "{colors.owner-action}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
    height: "44px"
  navigation-item:
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "11px 13px"
  request-option:
    backgroundColor: "{colors.option-ground}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.option}"
    padding: "18px"
  request-option-selected:
    backgroundColor: "{colors.selected-ground}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.option}"
    padding: "18px"
  request-composer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.workspace}"
    padding: "26px"
  policy-container:
    textColor: "{colors.foreground}"
    rounded: "{rounded.policy}"
    padding: "24px"
---

# Design System: Kusari

## Overview

**Creative North Star: "Dark Product Workspace"**

The user selected persistent navigation, a spacious agent workspace and compact policy controls. The system is restrained and task-first: charcoal surfaces, a self-hosted sans, quiet dividers and a soft mint primary action. It presents an operating product rather than a marketing page or a terminal imitation.

The agent's request and the observed result carry the attention. Policy, permissions and data freshness provide context; shared activity and technical evidence are available through disclosures. These are factual distinctions, so text and semantic structure carry them alongside color.

**Key Characteristics:**
- Persistent, familiar navigation.
- One clear primary request action.
- Readable labels and explicit state language.
- Flat tonal layering and restrained semantic color.
- Real model, policy and transaction evidence.

## Colors

The palette uses cool charcoal neutrals with soft mint for primary action, selection and positively observed state.

### Primary

- **Soft Mint:** the primary request action and observed positive states. Hover and pressed tones are separate primitives.
- **Deep Mint Ink:** text on the mint primary action.

### Neutral

- **Charcoal Canvas:** the page ground.
- **Navigation Charcoal:** the persistent navigation region.
- **Workspace Surface:** the main request composer.
- **Raised Charcoal:** secondary tonal separation where needed.
- **Slate Rule:** structural boundaries and dividers.
- **Cool White:** primary copy and data.
- **Slate Copy:** supporting labels, explanations and freshness text.

Amber and muted rose communicate warning and owner revocation actions. They are state vocabulary, not a second decorative palette.

**The Evidence Color Rule.** Color supports explicit state text; it never establishes success, authorization or privacy by itself.

## Typography

Instrument Sans is self-hosted from the local variable Latin font, with its OFL license beside it. It carries the interface's headings, controls and prose. Cascadia Code or Consolas is reserved for hashes, identifiers and protocol data.

### Hierarchy

- **Headline:** page identity. At the narrowest breakpoint it uses the observed smaller headline size (27px).
- **Title:** the main request composer heading.
- **Body:** explanatory copy; composer descriptions use a relaxed line-height (1.7), while general text uses the body token. Prose remains about 65–75 characters wide.
- **Label:** controls and compact product labels. Supporting technical metadata uses smaller, explicit text rather than a competing display treatment.
- **Data:** exact contract, pool and transaction identifiers; wrapping is allowed.

**The Product Voice Rule.** Labels name an action, object or observed state in sentence case. The interface does not rely on slogans to explain its task.

## Layout

The application shell has a persistent navigation rail at desktop widths from 1100px. Its rail is 216px wide and stays within the viewport height. The content region has a maximum width of 1424px, with increasing horizontal padding as the viewport grows. Below the desktop boundary, navigation becomes a three-destination row above the content.

The workspace has a main task area and a compact policy area. At the desktop breakpoint the policy column is 300px, increasing to 330px from 1500px. The main composer remains flexible and may shrink safely. Its request choices become two columns only when the composer's own container is at least 480px wide; this is not inferred from the viewport alone.

At narrow widths, task, policy and details form one reading order. The run facts change from label/value columns to stacked pairs. Prose, hashes and ENS names wrap rather than create horizontal scrolling. Spacing is tighter inside related groups and larger between task regions.

## Elevation & Depth

The workspace uses flat tonal separation and one-pixel borders. The main task is distinguished by surface, spacing and type, not a glow or a raised stack of cards. Disclosures use dividers; the result is a text-led boundary within the same task. No shadow token is established for these workspace surfaces.

## Shapes

Controls use compact curved corners; request options, policy context and the composer have progressively larger radii. Small pills are not a substitute for ordinary state text. The chain mark and authored SVG icons share a simple, consistent stroke language; the agent initial is an identity monogram.

## Components

### Buttons

The primary request action uses Soft Mint and Deep Mint Ink, a minimum target height from its token, and a clear label. Hover and pressed states use the extracted mint variants. Disabled requests use a neutral surface and muted text. The owner revocation action is an outlined rose control; restoration uses a restrained positive treatment. Both remain subordinate to the run action and retain their real authorization behavior.

Focus uses a two-pixel mint outline with a four-pixel offset. Ordinary color, background and border transitions use short ease-out durations. Reduced-motion preferences suppress animation and transition duration.

### Inputs / Fields

Request choices remain native labelled radios. The selected option uses a tinted ground and a thin mint rule. Focus is visible, explanatory text has an explicit association, and disabled state follows the actual request or origin state. No custom interaction replaces the native radio semantics.

### Navigation

The three destinations are Agent workspace, Overview & proof, and Owner controls. The current destination uses `aria-current` and a restrained tinted surface. Desktop navigation combines text and consistent SVG icons; the narrow layout keeps the text destinations visible. Source and network context are secondary information.

### Request Composer

The composer is one task container, with a heading, request choices, wallet readiness, signing explanation and primary action. A visitor's own decision, requested amount, outcome and receipt stay expanded. Their run-specific technical evidence is a native disclosure. The request's result remains distinct from the shared history.

### Policy Context

Policy values use aligned definition rows, explicit units and tabular numerals. Freshness is named in text. Source and hook links are subordinate but directly available. Owner controls remain inside this context and visually distinct from the visitor's request.

### Disclosures and Results

Shared history and integration evidence use native `details` and `summary` controls, initially closed. A small chevron rotates with the real open state. Technical diagrams use ordered steps and SVG connectors with a textual description. Success, known policy rejection, unknown revert, simulation, hold and unconfirmed execution retain distinct wording.

**The Request Summary Rule.** A run exposes Agent requested, Owner's limit, Result, Reason and Tx from its own events. Missing or unconfirmed evidence is stated plainly.

## Do's and Don'ts

### Do:
- **Do** retain the selected dark workspace, persistent navigation and clear task hierarchy.
- **Do** use the local Instrument Sans for product copy and reserve monospace for exact data.
- **Do** pair semantic color with explicit state text and visible keyboard focus.
- **Do** keep actual model decisions and transaction evidence separate from shared or recorded history.
- **Do** adapt to the available container width and let long identifiers wrap.

### Don't:
- **Don't** add decorative metrics, fabricated charts, balances or transaction outcomes.
- **Don't** use a marketing hero, glowing panels or terminal decoration as the workspace's main structure.
- **Don't** imply that a routing observation hides public transactions or the visitor wallet's RPC.
- **Don't** turn every explanation into another nested card or badge.
- **Don't** hide a hold, unknown revert, timeout or stale reading behind a positive color.
