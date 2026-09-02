# Preview cache strategy

[Theo Brooks](context-use://entity/theo-brooks) and [Jun Park](context-use://entity/jun-park) defined how [Compass](context-use://entity/compass) reuses resource previews during exploration.

## Strategy

Map batches provide enough summary data for hover. Full preview queries are cached by resource identity and retried only when a selected panel needs more detail. Validate perceived speed against the [pilot feedback](context-use://page/pilot-feedback).
