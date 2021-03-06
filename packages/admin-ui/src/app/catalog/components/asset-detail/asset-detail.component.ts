import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';

import { BaseDetailComponent } from '../../../common/base-detail.component';
import { Asset, LanguageCode } from '../../../common/generated-types';
import { NotificationService } from '../../../core/providers/notification/notification.service';
import { DataService } from '../../../data/providers/data.service';
import { ServerConfigService } from '../../../data/server-config';

@Component({
    selector: 'vdr-asset-detail',
    templateUrl: './asset-detail.component.html',
    styleUrls: ['./asset-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetDetailComponent extends BaseDetailComponent<Asset.Fragment> implements OnInit, OnDestroy {
    detailForm = new FormGroup({});

    constructor(
        router: Router,
        route: ActivatedRoute,
        serverConfigService: ServerConfigService,
        private notificationService: NotificationService,
        private dataService: DataService,
        private formBuilder: FormBuilder,
    ) {
        super(route, router, serverConfigService);
    }

    ngOnInit() {
        this.detailForm = new FormGroup({
            name: new FormControl(''),
        });
        this.init();
    }

    ngOnDestroy() {
        this.destroy();
    }

    onAssetChange(event: { id: string; name: string }) {
        // tslint:disable-next-line:no-non-null-assertion
        this.detailForm.get('name')!.setValue(event.name);
        // tslint:disable-next-line:no-non-null-assertion
        this.detailForm.get('name')!.markAsDirty();
    }

    save() {
        this.dataService.product
            .updateAsset({
                id: this.id,
                name: this.detailForm.value.name,
            })
            .subscribe(
                () => {
                    this.notificationService.success(_('common.notify-update-success'), { entity: 'Asset' });
                },
                err => {
                    this.notificationService.error(_('common.notify-update-error'), {
                        entity: 'Asset',
                    });
                },
            );
    }

    protected setFormValues(entity: Asset.Fragment, languageCode: LanguageCode): void {
        // tslint:disable-next-line:no-non-null-assertion
        this.detailForm.get('name')!.setValue(entity.name);
    }
}
