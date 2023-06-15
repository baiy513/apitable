/**
 * APITable <https://github.com/apitable/apitable>
 * Copyright (C) 2022 APITable Ltd. <https://apitable.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import {
  FieldType, IEventResourceMap, ILinkField, ILookUpField, ILookUpProperty,
  IMeta, IReduxState, IServerDatasheetPack,
} from '@apitable/core';
import { Span } from '@metinseylan/nestjs-opentelemetry';
import { forwardRef, Inject, Injectable } from '@nestjs/common';

import { InjectLogger } from 'shared/common';

import { Logger } from 'winston';
import { NodeService } from 'node/services/node.service';
import { DatasheetMetaService } from './datasheet.meta.service';
import { DatasheetRecordService } from './datasheet.record.service';
import { ComputeFieldReferenceManager } from './compute.field.reference.manager';
import {calcCellValueAndString} from "@apitable/core/dist/modules/database/store/selectors/resource/datasheet/cell_calc";
import {DatasheetService} from "./datasheet.service";
import { CommandService } from 'database/command/services/command.service';
@Injectable()
export class DatasheetCacheToDbService{
  constructor(
    @InjectLogger() private readonly logger: Logger,
    private readonly datasheetMetaService: DatasheetMetaService,
    private readonly dataSheetService: DatasheetService,
    private readonly commandService: CommandService,
    private readonly datasheetRecordService: DatasheetRecordService,
    private readonly computeFieldReferenceManager: ComputeFieldReferenceManager,
    @Inject(forwardRef(() => NodeService))
    private readonly nodeService: NodeService
  ) {}
  /**
   * cache the filter value to database,to fast the filter,magic link not comp
   */
  @Span()
  async  cacheFilterToDatabase(dstId: string,recordIds:string[],changedFields:string[]) {
     const globalTraceMap:Map<string,Object>=new Map<string, Object>();
     await this.internalCacheFilterToDatabase(dstId,recordIds,changedFields,globalTraceMap);
    this.logger.info('cacheFilterToDatabase globalTraceMap', globalTraceMap);
  }

  /**
   * recursive cache the filter value to database,to fast the filter,magic link not comp
   * the difficult is to find affect datasheet recursive and the efficent
   */
  @Span()
  async  internalCacheFilterToDatabase(dstId: string,recordIds:string[],affectFields:string[],parentMap:Map<string,Object>) {

    this.logger.info("start cacheFilterToDatabase dstId:${dstId} affectFields:${affectFields}");
    const traceMap:Map<string,Object>=new Map<string, Object>();
    parentMap.set(dstId,traceMap);
    //if(dstToFieldMap.size>0&&dstToFieldMap.get(dstId)) {
    const {needModifyFields,allAffectFields}= await this.getNeedModifyFields(affectFields, dstId);

    if (needModifyFields&&needModifyFields.length > 0) {//find need cac and cached field

      this.logger.info("start cacheFilterToDatabase dstId:${dstId} mirrorFilterFields:${mirrorFilterFields}");

      await this.updateDataBase(dstId, recordIds, needModifyFields);
      traceMap.set("updateDataBase",[recordIds,needModifyFields])
    }
    if (allAffectFields&&allAffectFields.length > 0) {//find need cac and cached field
      traceMap.set("allAffectFields",allAffectFields)
      await this.dealCacheParent(allAffectFields, dstId, recordIds,traceMap);
    }
  }

  private async dealCacheParent(affectFields: string[], dstId: string, recordIds: string[],parentMap:Map<string,Object>) {

    const parentDstToFieldMap = await this.findParentDstFields(affectFields, dstId);
    for (const [refDstId, refFields] of parentDstToFieldMap) {//处理影响的父表一级引用表

      const metaData = await this.datasheetMetaService.getMetaDataByDstId(refDstId);
      const linkLookupMap = this.findSelfLinkField(refFields, metaData);
      this.logger.info("start cacheFilterToDatabase dstId:${dstId}  linkLookupMap:${linkLookupMap}");
      if (linkLookupMap.size > 0) {//根据双向关联,找出影响的父表格rids,然后更新
        const recordMap = await this.datasheetRecordService.getRecordsByDstIdAndRecordIds(dstId, recordIds);
        if (recordMap) {
          this.logger.info("start cacheFilterToDatabase get recordMap ${recordMap}");

          for (const [opLinkFieldId, linkFields] of linkLookupMap) {
            const foreignRids: string[] = [];
            for (const rid of recordIds) {
              if (recordMap[rid] && recordMap[rid]?.data && recordMap[rid]?.data[opLinkFieldId]) {
                const rids = recordMap[rid]?.data[opLinkFieldId] as [];
                foreignRids.push(...rids);
              }
            }
            if (foreignRids.length > 0 && linkFields.length > 0) {
              await this.internalCacheFilterToDatabase(refDstId, foreignRids, linkFields,parentMap);
            }
          }
        }
      }
    }
  }

  private async getNeedModifyFields(changedFields: string[], dstId: string):
                              Promise<{needModifyFields:string[]|undefined,allAffectFields:string[]|undefined}> {
    let curRefFields = changedFields;
    let nodeRefs = null;
    if (curRefFields && curRefFields.length > 0)
      nodeRefs = await this.nodeService.getRelNodeInfoByMainNode(dstId);

    curRefFields = await this.findSelfAllAffectFields(curRefFields, dstId);
    if (nodeRefs && nodeRefs.length > 0) {//找出修改导致本表一些列改变，并且这些列影响到过滤列

      this.logger.info("start cacheFilterToDatabase get nodeRefs ");

      const metaData = await this.datasheetMetaService.getMetaDataByDstId(dstId);
      for(const key of Object.keys(metaData.fieldMap)){//神奇引用和关联之间的关系
        const field=metaData.fieldMap[key];
        if(field&&field.type==FieldType.LookUp){
          const { relatedLinkFieldId } = field.property as ILookUpProperty;
          if(curRefFields.includes(relatedLinkFieldId)){
            curRefFields.push(field.id)
          }
        }
      }
      this.logger.info("start cacheFilterToDatabase newRefids dstId:${dstId} newRefids:${newRefids}");

      let mirrorFilterFields:string[]=[];
      for (const nodeRef of nodeRefs) {
        const view = metaData.views.find(view => view.id === nodeRef.viewId)

        if (view && view.filterInfo && view.filterInfo.conditions) {
          const filterFields = curRefFields.filter((refFieldId: string) => {
            for (const condtion of view!.filterInfo!.conditions) {
              if (condtion.fieldId == refFieldId) {
                return true;
              }
            }
            return false;
          })
          if(filterFields){
            mirrorFilterFields=[...mirrorFilterFields,...filterFields];
          }
        }
      }
      return {needModifyFields:mirrorFilterFields,allAffectFields:curRefFields};
    }
    return {needModifyFields:undefined,allAffectFields:curRefFields};
  }

  private async findSelfAllAffectFields(curRefFields: string[], dstId: string) {
    let newRefids: string[] = curRefFields!;
    while (newRefids.length > 0) {//找出多级间接引用
      let nextRefids: string[] = [];
      for (const fid of newRefids) {
        const refMap = await this.computeFieldReferenceManager.getReRefDstToFieldMap(dstId, fid);
        if (refMap && refMap.get(dstId)) {

          nextRefids = [...(refMap.get(dstId) as string[]), ...nextRefids];
          curRefFields = [...(refMap.get(dstId) as string[]), ...curRefFields];
        }
      }
      newRefids = nextRefids;
    }
    return curRefFields;
  }

  private async findParentDstFields(changedFields: string[], dstId: string) {
    const dstToFieldMap: Map<string, string[]> = new Map<string, string[]>();
    for (const fid of changedFields) {
      const refMap = await this.computeFieldReferenceManager.getReRefDstToFieldMap(dstId, fid);
      if (refMap) {
        for (const [refDstId, fieldIds] of refMap) {
          if (dstToFieldMap.has(refDstId)) {
            dstToFieldMap.set(refDstId, [...dstToFieldMap.get(refDstId)!, ...fieldIds]);
          } else {
            dstToFieldMap.set(refDstId, fieldIds);
          }
        }
      }
    }
    dstToFieldMap.delete(dstId);//不包含自己
    return dstToFieldMap;
  }

  private async updateDataBase(dstId: string, recordIds: string[], mirrorFilterFields: string[]) {
    const resource: Map<string, string[]> = new Map<string, string[]>();
    resource.set(dstId, recordIds);
    const resourceFields: Map<string, string[]> = new Map<string, string[]>();
    resourceFields.set(dstId, mirrorFilterFields);
    const state = await this.makeState(resource,resourceFields);//get data pack
    const snapshot = state.datasheetMap[dstId]?.datasheet?.snapshot;
    const recordSnapShot = {
      meta: {fieldMap: snapshot!.meta.fieldMap},
      recordMap: snapshot!.recordMap,
      datasheetId: dstId
    }
    for (const rid of recordIds) {
      const cellData = [];
      for (const fid of mirrorFilterFields) {
        const {cellValue} = calcCellValueAndString({state:state, snapshot:recordSnapShot,recordId:rid, fieldId:fid});
        if(cellValue&&cellValue.length==1)
          cellData.push({fieldId: fid, data: cellValue[0]})
        else
          cellData.push({fieldId: fid, data: cellValue})
      }
      this.logger.info("start cacheFilterToDatabase  dstId:${dstId} cellData :${cellData}");
      const result = await this.datasheetRecordService.updateCell(dstId, rid, cellData);
      this.logger.info("cacheFilterToDatabase" + result.affected)
    }
  }

  private  findSelfLinkField(refFields: string[], metaData: IMeta):Map<string, string[]> {

    const linkLookupMap: Map<string, string[]>=new Map<string, string[]>();
    for (const refField of refFields) {
      const fieldInfo = metaData.fieldMap[refField];
      if (fieldInfo && fieldInfo.type == FieldType.LookUp) {//找到神奇关联列，借助双向关联

        this.logger.info("start cacheFilterToDatabase FieldType.LookUp other dstId:${refDstId} refFields:${refFields}");

        const lookupField = fieldInfo as ILookUpField;
        const linkFid = lookupField.property.relatedLinkFieldId;
        const linkFieldInfo = metaData.fieldMap[linkFid] as ILinkField;
        const opLinkFieldId = linkFieldInfo?.property.brotherFieldId;
        if (opLinkFieldId) {
          if (linkLookupMap.has(opLinkFieldId)) {
            linkLookupMap.set(opLinkFieldId, [...linkLookupMap.get(opLinkFieldId)!, refField]);
          } else {
            linkLookupMap.set(opLinkFieldId, [refField]);
          }
        }
      }
    }
    return linkLookupMap;
  }
  /**
   * Analyze ops, figure out op resource dependency, query database and construct sparse store.
   */
  private async makeState(resourceMap: IEventResourceMap,resourceFieldsMap:Map<string,string[]>): Promise<IReduxState> {
    const datasheetPacks: IServerDatasheetPack[] = await this.dataSheetService.getTinyBasePacks(resourceMap,resourceFieldsMap);
    this.logger.debug('datasheetPacks', datasheetPacks);
    return this.commandService.fillTinyStore(datasheetPacks).getState();
  }
}
