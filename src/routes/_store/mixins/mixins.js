import { instanceMixins } from './instanceMixins.js'
import { atprotoMixins } from './atprotoMixins.js'

export function mixins (Store) {
  instanceMixins(Store)
  atprotoMixins(Store) // Add ATProto mixins
}
