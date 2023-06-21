import {FieldType, FilterConjunction, FOperator, IFilterInfo} from "@apitable/core";
import dayjs from "dayjs";
import {UnitInfo} from "../interfaces";

export function buildConditions(filterInfo: IFilterInfo,unitInfo?:UnitInfo):
    { sqlWhere: Array<{ sqlCondition: String|null, sqlParam: Object | null } >, sqlConjunction: FilterConjunction } {
    const conditions = filterInfo.conditions;
    const sqlWhere: Array<{sqlCondition: String|null, sqlParam: Object | null } > = [];

    conditions.forEach(condition => {

        const {sqlCondition, sqlParam} = buildCondition(condition.fieldId,condition.fieldType, condition.operator, condition.value,unitInfo)
        sqlWhere.push({sqlCondition, sqlParam})
    });
    return {sqlWhere: sqlWhere, sqlConjunction: filterInfo!.conjunction};
}

function buildCondition(
    fieldId: string, fieldType:FieldType,operator: FOperator, conditionValue: Object[],unitInfo?:UnitInfo
): { sqlCondition: String|null, sqlParam: Object | null } {
    const txtField:String="data->'$."+fieldId+"[0].text'";
    const numField:String="data->'$."+fieldId+"'";
    const memberField:String="data->'$."+fieldId+"'";

    let operatorField:String|undefined=undefined;
    if(fieldType==FieldType.CreatedBy){
        operatorField="created_by";
    }else if(fieldType==FieldType.LastModifiedBy){
        operatorField="updated_by";
    }
    if (operator === FOperator.IsEmpty) {
        if(fieldType==FieldType.Number)
            return {sqlCondition: numField + " is null", sqlParam: null}
        if(fieldType==FieldType.Member)
            return {sqlCondition: memberField + " is null", sqlParam: null}
        if(operatorField)
            return {sqlCondition: operatorField + " is null", sqlParam: null}
        return {sqlCondition: txtField + " is null", sqlParam: null}
    }
    if (operator === FOperator.IsNotEmpty) {
        if(fieldType==FieldType.Number)
            return {sqlCondition: numField + " is not null", sqlParam: null}
        if(fieldType==FieldType.Member)
            return {sqlCondition: memberField + " is not null", sqlParam: null}
        if(operatorField)
            return {sqlCondition: operatorField + " is not null", sqlParam: null}
        return {sqlCondition: txtField + " is not null", sqlParam: null}
    }
    if (conditionValue === null) {
        return {sqlCondition: null, sqlParam: null};
    }
    let [filterValue] = conditionValue;
    const txtParam={};
    const numParam={};
    const likeParam={};

    if(filterValue=="Self"&&unitInfo){
        if(operatorField){
            filterValue=unitInfo.userId;
        }else if(fieldType==FieldType.Member){
            filterValue=unitInfo.unitId;
        }
    }
    txtParam[fieldId]=(filterValue+"").trim()
    if(conditionValue[0]&&conditionValue[1]){
        if(conditionValue[0]=='SomeDayBefore'){
            numParam[fieldId]=dayjs().add(Number(conditionValue[1])*-1, 'day').startOf('day').valueOf();
        }else if(conditionValue[0]=='SomeDayAfter'){
            numParam[fieldId]=dayjs().add(Number(conditionValue[1]), 'day').startOf('day').valueOf();
        }
    }else{
        numParam[fieldId]=Number((filterValue+"").trim())

    }
    likeParam[fieldId]="%"+(filterValue+"").trim()+"%"

    switch (operator) {
        case FOperator.Is: {
            if(filterValue instanceof Number)
                return {sqlCondition: numField + " = :" + fieldId, sqlParam: numParam}
            if(operatorField){
                return {sqlCondition: operatorField + " = :" + fieldId, sqlParam: txtParam}
            }
            if(fieldType==FieldType.Member)
                return {sqlCondition: memberField + " like :" + fieldId, sqlParam: likeParam}
            return {sqlCondition: txtField + " = :" + fieldId, sqlParam: txtParam}
        }
        case FOperator.IsNot: {
            if(filterValue instanceof Number)
                return {sqlCondition: numField + " != :" + fieldId, sqlParam: numParam}
            if(fieldType==FieldType.Member)
                return {sqlCondition: memberField + " not like :" +fieldId, sqlParam: likeParam}
            if(operatorField){
                return {sqlCondition: operatorField + " != :" + fieldId, sqlParam: txtParam}
            }
            return {sqlCondition: txtField + " != :" + fieldId, sqlParam: txtParam}
        }
        case FOperator.Contains: {
            if(operatorField)
                return {sqlCondition: operatorField + " like :" + fieldId , sqlParam: likeParam}
            if(fieldType==FieldType.Member)
                return {sqlCondition: memberField + " like :" + fieldId, sqlParam: likeParam}
            return {sqlCondition: txtField + " like :" + fieldId , sqlParam: likeParam}
        }
        case FOperator.DoesNotContain: {
            if(operatorField)
                return {sqlCondition: operatorField + " not like :" + fieldId , sqlParam: likeParam}
            if(fieldType==FieldType.Member)
                return {sqlCondition: memberField + " not like :" + fieldId, sqlParam: likeParam}
            return {sqlCondition: txtField + " not like :" + fieldId , sqlParam:likeParam}
        }
        case FOperator.IsGreater: {
            return {sqlCondition: numField + ">:" + fieldId, sqlParam:numParam}
        }
        case FOperator.IsGreaterEqual: {
            return {sqlCondition: numField + ">=:" + fieldId , sqlParam:numParam}
        }
        case FOperator.IsLess: {
            return {sqlCondition: numField + "<:" + fieldId, sqlParam:numParam}
        }
        case FOperator.IsLessEqual: {
            return {sqlCondition: numField + "<=:" + fieldId , sqlParam:numParam}
        }
        default: {
            return {sqlCondition: null, sqlParam: null};
        }
    }
}

