import {FilterConjunction, FOperator, IFilterInfo} from "@apitable/core";
import dayjs from "dayjs";

export function buildConditions(filterInfo: IFilterInfo,):
    { sqlWhere: Array<{ sqlCondition: String|null, sqlParam: Object | null } >, sqlConjunction: FilterConjunction } {
    const conditions = filterInfo.conditions;
    const sqlWhere: Array<{sqlCondition: String|null, sqlParam: Object | null } > = [];
    conditions.forEach(condition => {
        const {sqlCondition, sqlParam} = buildCondition(condition.fieldId, condition.operator, condition.value)
        sqlWhere.push({sqlCondition, sqlParam})
    });
    return {sqlWhere: sqlWhere, sqlConjunction: filterInfo!.conjunction};
}

function buildCondition(
    fieldId: string, operator: FOperator, conditionValue: Object[]
): { sqlCondition: String|null, sqlParam: Object | null } {
    const condition:String="data->'$."+fieldId+"[0].text'";
    const condition1:String="data->'$."+fieldId+"'";

    if (operator === FOperator.IsEmpty) {
        return {sqlCondition: condition + " is null", sqlParam: null}
    }
    if (operator === FOperator.IsNotEmpty) {
        return {sqlCondition: condition + " is not null", sqlParam: null}
    }
    if (conditionValue === null) {
        return {sqlCondition: null, sqlParam: null};
    }
    const [filterValue] = conditionValue;
    const sqlParam={};
    const sqlParam2={};
    const sqlParam3={};

    sqlParam[fieldId]=(filterValue+"").trim()
    if(conditionValue[0]&&conditionValue[1]){
        if(conditionValue[0]=='SomeDayBefore'){
            sqlParam2[fieldId]=dayjs().add(Number(conditionValue[1])*-1, 'day').startOf('day').valueOf();
        }else if(conditionValue[0]=='SomeDayAfter'){
            sqlParam2[fieldId]=dayjs().add(Number(conditionValue[1]), 'day').startOf('day').valueOf();
        }
    }else{
        sqlParam2[fieldId]=Number((filterValue+"").trim())

    }
    sqlParam3[fieldId]="%"+(filterValue+"").trim()+"%"

    switch (operator) {
        case FOperator.Is: {
            return {sqlCondition: condition + " = :" + fieldId, sqlParam: sqlParam}
        }
        case FOperator.IsNot: {
            return {sqlCondition: condition + " != :" + fieldId, sqlParam: sqlParam}
        }
        case FOperator.Contains: {
            return {sqlCondition: condition + " like :" + fieldId , sqlParam: sqlParam3}
        }
        case FOperator.DoesNotContain: {
            return {sqlCondition: condition + " not like :" + fieldId , sqlParam:sqlParam3}
        }
        case FOperator.IsGreater: {
            return {sqlCondition: condition1 + ">:" + fieldId, sqlParam:sqlParam2}
        }
        case FOperator.IsGreaterEqual: {
            return {sqlCondition: condition1 + ">=:" + fieldId , sqlParam:sqlParam2}
        }
        case FOperator.IsLess: {
            return {sqlCondition: condition1 + "<:" + fieldId, sqlParam:sqlParam2}
        }
        case FOperator.IsLessEqual: {
            return {sqlCondition: condition1 + "<=:" + fieldId , sqlParam:sqlParam2}
        }
        default: {
            return {sqlCondition: null, sqlParam: null};
        }
    }
}

export function mapToDictionary(map: Map<any, any>): { [key: string]: any } {
    const dict = {};
    for (const [k, v] of map.entries()) {
        if (v instanceof Map) {
            dict[k] = mapToDictionary(v);
        } else {
            dict[k] = v;
        }
    }
    return dict;
}
//
// const myMap = new Map([
//     ['a', new Map([['b', 1], ['c', 2]])],
// ['d', new Map([['e', 3], ['f', 4]])]
// ]);
//
// const dict = mapToDictionary(myMap);
// const jsonString = JSON.stringify(dict, null, 2);
//
// console.log(jsonString);
