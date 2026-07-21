import { Global, Inject, Module, OnModuleInit } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { ELASTICSEARCH_CLIENT, MESSAGES_INDEX } from './elasticsearch.constants';

async function ensureMessagesIndex(client: Client) {
  const exists = await client.indices.exists({ index: MESSAGES_INDEX });
  if (!exists) {
    await client.indices.create({
      index: MESSAGES_INDEX,
      mappings: {
        properties: {
          conversation_id: { type: 'keyword' },
          from_user_id: { type: 'keyword' },
          body: { type: 'text' },
          seq: { type: 'long' },
          created_at: { type: 'date' },
        },
      },
    });
    console.log('Created messages index');
  }
}

@Global()
@Module({
  providers: [
    {
      provide: ELASTICSEARCH_CLIENT,
      useFactory: () =>
        process.env.ELASTIC_SEARCH_CLOUD_ID
          ? new Client({
              cloud: { id: process.env.ELASTIC_SEARCH_CLOUD_ID as string },
              auth: { apiKey: process.env.ELASTIC_SEARCH_API_KEY as string },
            })
          : new Client({ node: 'http://localhost:9200' }),
    },
  ],
  exports: [ELASTICSEARCH_CLIENT],
})
export class ElasticsearchModule implements OnModuleInit {
  constructor(@Inject(ELASTICSEARCH_CLIENT) private readonly client: Client) {}

  onModuleInit() {
    // Skip entirely when running in production with no real Elasticsearch/OpenSearch
    // configured, so a deployment that intentionally omits it doesn't slow-fail
    // against an unreachable localhost:9200 on every boot. Locally this still runs
    // as before, tolerating a missing local ES via the .catch below.
    if (process.env.ELASTIC_SEARCH_CLOUD_ID || process.env.NODE_ENV !== 'production') {
      ensureMessagesIndex(this.client).catch(console.error);
    }
  }
}
