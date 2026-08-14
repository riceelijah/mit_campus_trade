# Card art

Finished front/back card renders, one file per card, named by collection/dex number (`n`):

```
fronts/<n>.png   e.g. fronts/1.png, fronts/2.png, ... fronts/72.png
backs/<n>.png    e.g. backs/1.png,  backs/2.png,  ... backs/72.png
```

`CardArt` (`src/components/CardArt.tsx`, thumbnails) and `FlippableCard`
(`src/components/FlippableCard.tsx`, the card detail page) load these directly from
`/art/fronts/<n>.png` and `/art/backs/<n>.png`. If a card's file is missing, both fall back
to the color-placeholder card face automatically, so art can still be added incrementally.

`fronts/_extra-duplicate-of-71.png` is a leftover extra front render for card 71 (Kayode
Dada) that came in alongside `fronts/71.png` -- not wired up anywhere. Worth a look to see
which of the two is the one you actually want; delete whichever isn't.
