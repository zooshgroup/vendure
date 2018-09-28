import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { UpdateProductVariantInput } from 'shared/generated-types';
import { ID } from 'shared/shared-types';
import { generateAllCombinations } from 'shared/shared-utils';
import { Connection } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { DEFAULT_LANGUAGE_CODE } from '../../common/constants';
import { Translated } from '../../common/types/locale-types';
import { assertFound, idsAreEqual } from '../../common/utils';
import { FacetValue } from '../../entity/facet-value/facet-value.entity';
import { ProductOption } from '../../entity/product-option/product-option.entity';
import { CreateProductVariantDto } from '../../entity/product-variant/create-product-variant.dto';
import { ProductVariantPrice } from '../../entity/product-variant/product-variant-price.entity';
import { ProductVariantTranslation } from '../../entity/product-variant/product-variant-translation.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { Product } from '../../entity/product/product.entity';
import { I18nError } from '../../i18n/i18n-error';

import { createTranslatable } from '../helpers/create-translatable';
import { translateDeep } from '../helpers/translate-entity';
import { TranslationUpdaterService } from '../helpers/translation-updater.service';
import { updateTranslatable } from '../helpers/update-translatable';

@Injectable()
export class ProductVariantService {
    constructor(
        @InjectConnection() private connection: Connection,
        private translationUpdaterService: TranslationUpdaterService,
    ) {}

    findOne(ctx: RequestContext, productVariantId: ID): Promise<Translated<ProductVariant> | undefined> {
        const relations = [];
        return this.connection
            .getRepository(ProductVariant)
            .findOne(productVariantId, { relations })
            .then(result => {
                if (result) {
                    return translateDeep(this.applyChannelPrice(result, ctx.channelId), ctx.languageCode);
                }
            });
    }

    async create(
        ctx: RequestContext,
        product: Product,
        createProductVariantDto: CreateProductVariantDto,
    ): Promise<ProductVariant> {
        const save = createTranslatable(ProductVariant, ProductVariantTranslation, async variant => {
            const { optionCodes } = createProductVariantDto;
            if (optionCodes && optionCodes.length) {
                const options = await this.connection.getRepository(ProductOption).find();
                const selectedOptions = options.filter(og => optionCodes.includes(og.code));
                variant.options = selectedOptions;
            }
            variant.product = product;
            const variantPrice = new ProductVariantPrice();
        });
        return await save(this.connection, createProductVariantDto, { channelId: ctx.channelId });
    }

    async update(updateProductVariantsDto: UpdateProductVariantInput): Promise<Translated<ProductVariant>> {
        const save = updateTranslatable(
            ProductVariant,
            ProductVariantTranslation,
            this.translationUpdaterService,
        );
        await save(this.connection, updateProductVariantsDto);
        const variant = await assertFound(
            this.connection.manager.getRepository(ProductVariant).findOne(updateProductVariantsDto.id, {
                relations: ['options', 'facetValues'],
            }),
        );
        return translateDeep(variant, DEFAULT_LANGUAGE_CODE, ['options', 'facetValues']);
    }

    async generateVariantsForProduct(
        ctx: RequestContext,
        productId: ID,
        defaultPrice?: number | null,
        defaultSku?: string | null,
    ): Promise<Array<Translated<ProductVariant>>> {
        const product = await this.connection.getRepository(Product).findOne(productId, {
            relations: ['optionGroups', 'optionGroups.options'],
        });

        if (!product) {
            throw new I18nError('error.entity-with-id-not-found', { entityName: 'Product', id: productId });
        }
        const defaultTranslation = product.translations.find(t => t.languageCode === DEFAULT_LANGUAGE_CODE);

        const productName = defaultTranslation ? defaultTranslation.name : `product_${productId}`;
        const optionCombinations = product.optionGroups.length
            ? generateAllCombinations(product.optionGroups.map(g => g.options))
            : [[]];

        const variants: ProductVariant[] = [];
        for (const options of optionCombinations) {
            const name = this.createVariantName(productName, options);
            const variant = await this.create(ctx, product, {
                sku: defaultSku || 'sku-not-set',
                price: defaultPrice || 0,
                optionCodes: options.map(o => o.code),
                translations: [
                    {
                        languageCode: ctx.languageCode,
                        name,
                    },
                ],
            });
            variants.push(variant);
        }

        return variants.map(v => translateDeep(v, DEFAULT_LANGUAGE_CODE));
    }

    async addFacetValues(
        productVariantIds: ID[],
        facetValues: FacetValue[],
    ): Promise<Array<Translated<ProductVariant>>> {
        const variants = await this.connection.getRepository(ProductVariant).findByIds(productVariantIds, {
            relations: ['options', 'facetValues'],
        });

        const notFoundIds = productVariantIds.filter(id => !variants.find(v => idsAreEqual(v.id, id)));
        if (notFoundIds.length) {
            throw new I18nError('error.entity-with-id-not-found', {
                entityName: 'ProductVariant',
                id: notFoundIds[0],
            });
        }
        for (const variant of variants) {
            for (const facetValue of facetValues) {
                if (!variant.facetValues.map(fv => fv.id).includes(facetValue.id)) {
                    variant.facetValues.push(facetValue);
                }
            }
            await this.connection.manager.save(variant);
        }

        return variants.map(v => translateDeep(v, DEFAULT_LANGUAGE_CODE, ['options', 'facetValues']));
    }

    /**
     * Populates the `price` field with the price for the specified channel.
     */
    applyChannelPrice(variant: ProductVariant, channelId: ID): ProductVariant {
        const channelPrice = variant.productVariantPrices.find(p => idsAreEqual(p.channelId, channelId));
        if (!channelPrice) {
            throw new I18nError(`error.no-price-found-for-channel`);
        }
        variant.price = channelPrice.price;
        return variant;
    }

    private createVariantName(productName: string, options: ProductOption[]): string {
        const optionsSuffix = options
            .map(option => {
                const defaultTranslation = option.translations.find(
                    t => t.languageCode === DEFAULT_LANGUAGE_CODE,
                );
                return defaultTranslation ? defaultTranslation.name : option.code;
            })
            .join(' ');

        return options.length ? `${productName} ${optionsSuffix}` : productName;
    }
}