// Conformance fixtures for the file adapters: one entry per registered adapter id.
//
// Adding a file adapter means adding its sample here. The contract test in
// scanner.test.mjs fails until every registered adapter has one, so a new format
// cannot land without a parse example and a rejection example.
//
//   text       one locale file in this format, exercising whatever nesting or
//              coercion the format expresses
//   entries    the normalized entries `parse` must return, in order
//   malformed  texts the adapter must reject with {ok: false, reason}
export const ADAPTER_FIXTURES = {
 json: {
  text: '{"menu": {"save": "Save"}, "tips": ["a"], "count": 3, "missing": null}',
  entries: [
   {key: 'menu.save', value: 'Save'},
   {key: 'tips.0', value: 'a'},
   {key: 'count', value: '3'},
   {key: 'missing', value: ''}
  ],
  malformed: ['{', '["a", "b"]', '"just a string"', 'null']
 }
};
