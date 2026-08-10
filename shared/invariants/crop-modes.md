## Crop Modes

`c_fill` covers the target box and crops overflow. `c_crop` also crops to the
exact dimensions, while `c_fit` keeps the whole image visible inside the box.

| Tokens | Behavior |
|--------|----------|
| `w_` only, or `h_` only | Scales, aspect ratio preserved |
| `w_` + `h_`, no crop mode | Crops to fill the box |
| `c_crop` | Crops to fill the box |
| `c_fill` | Covers the box and crops overflow |
| `c_fit` | Fits inside the box |

With a fixed shape required and no stated preference, use `c_fill`.
