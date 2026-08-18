import type { LeaderCard } from "@tcg/op-types";
import { op15Lucy002I18n } from "./002-lucy.i18n.ts";

export const op15Lucy002: LeaderCard = {
  id: "OP15-002",
  canonicalId: "OP15-002",
  slug: "lucy/op15-002",
  name: "Lucy",
  printings: [
    {
      id: "OP15-002",
      artId: "OP15-002",
      setCode: "OP15",
      collectorNumber: "002",
      rarity: "L",
      imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP15-002.png",
    },
  ],
  cardType: "leader",
  color: ["red", "blue"],
  rarity: "L",
  setId: "OP15",
  power: 5000,
  life: 4,
  traits: ["Dressrosa", "Revolutionary Army"],
  attribute: "strike",
  effect:
    "[When Attacking]/[On Your Opponent's Attack] You may trash any number of Event or Stage cards from your hand. This Leader gains +1000 power during this battle for every card trashed.\n[Activate: Main] [Once Per Turn] If you have activated an Event with a base cost of 3 or more during this turn, draw 1 card.",
  // PARKED -- the second printed clause ("[Activate: Main] [Once Per Turn] If you have activated an
  // Event with a base cost of 3 or more during this turn, draw 1 card") is NOT encoded below. It
  // needs a condition over *this turn's event-activation history*, and no such state exists: the
  // engine fires a `whenYouActivateEvent` trigger at activation time but never records that an
  // activation happened, so there is nothing for a later [Activate: Main] to test. Ruling #853
  // sharpens what the missing primitive must do rather than removing the need for it -- activating
  // an Event's [Trigger] effect is explicitly NOT "activating an Event" (发动【触发】效果和发动事件
  // 不同), so the tracker would have to exclude Trigger resolutions.
  //
  // Re-expressing it as a `whenYouActivateEvent` block that draws immediately was rejected as an
  // approximation, not adopted: it would draw without the player choosing to activate the Leader,
  // it would fix the draw's ordering to the Event's resolution, and it would still fire for an
  // Event activated during the opponent's turn via [Counter] -- a turn in which the printed
  // [Activate: Main] can never be used at all.
  effects: {
    effects: [
      {
        trigger: "whenAttacking",
        actions: [
          {
            action: "trashFromHand",
            player: "self",
            amount: "all",
            upTo: true,
            filters: [
              {
                filter: "anyOf",
                groups: [
                  [{ filter: "cardCategory", value: "event" }],
                  [{ filter: "cardCategory", value: "stage" }],
                ],
              },
            ],
          },
          {
            action: "modifyPower",
            target: {
              player: "self",
              zones: ["leader"],
              count: { amount: 1 },
              self: true,
            },
            value: 0,
            valuePerPreviousActionTarget: 1000,
            duration: "thisBattle",
          },
        ],
      },
      {
        // Deliberately NO `eventFilter: { targetSelf: true }`, and this is a real fork in the
        // vendored engine's own conventions rather than a detail. The action shape above is copied
        // from OP03/leaders/001-portgas-d-ace.ts, which DOES carry `targetSelf` -- correctly, because
        // its printed text is the older wording "When this Leader attacks or is attacked", which
        // scopes the trigger to the Leader itself. This card instead prints the modern keyword
        // [On Your Opponent's Attack] (SC: 【对方的攻击时】), which carries no target restriction.
        // The matching precedent is OP11/leaders/041-nami.ts: same modern keyword, same "This Leader
        // gains +N power" payload, no `targetSelf`. `enqueueInPlayEffectsForTrigger(state,
        // "onOpponentAttack", ...)` in battle.ts fires for the defending seat on ANY declared attack
        // regardless of target, so the distinction is observable, and GENERAL ruling #8 confirms a
        // power boost may legitimately be applied to a card that is not the one being attacked.
        // (OP13/leaders/002-portgas-d-ace.ts pairs the modern keyword WITH `targetSelf`, so upstream
        // is not self-consistent here; that card's payload debuffs the opponent rather than pumping
        // itself, and it is not this batch's card to fix.)
        trigger: "onOpponentAttack",
        actions: [
          {
            action: "trashFromHand",
            player: "self",
            amount: "all",
            upTo: true,
            filters: [
              {
                filter: "anyOf",
                groups: [
                  [{ filter: "cardCategory", value: "event" }],
                  [{ filter: "cardCategory", value: "stage" }],
                ],
              },
            ],
          },
          {
            action: "modifyPower",
            target: {
              player: "self",
              zones: ["leader"],
              count: { amount: 1 },
              self: true,
            },
            value: 0,
            valuePerPreviousActionTarget: 1000,
            duration: "thisBattle",
          },
        ],
      },
    ],
  },
  i18n: op15Lucy002I18n,
};
