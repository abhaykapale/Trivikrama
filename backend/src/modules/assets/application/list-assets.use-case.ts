import {
  toAssetListFilters,
  toAssetView,
  type AssetQueryRepository,
  type ListAssetsInput,
  type ListAssetsResult,
} from "../domain/asset.contracts.js";

export class ListAssetsUseCase {
  public constructor(private readonly assets: AssetQueryRepository) {}

  public async execute(input: ListAssetsInput): Promise<ListAssetsResult> {
    const filters = toAssetListFilters(input);
    const [page, total] = await Promise.all([
      this.assets.list(filters),
      this.assets.count(filters),
    ]);
    return {
      data: page.items.map(toAssetView),
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / input.limit),
        hasNext: input.page * input.limit < total,
        hasPrev: input.page > 1,
      },
    };
  }
}
