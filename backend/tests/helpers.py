import json

PLAN_BODY = {
    "address": "12 Lodhi Road, New Delhi", "lat": 28.59, "lon": 77.22, "ward": "Lodhi Colony",
    "roofAreaM2": 120, "plotAreaM2": 150, "residents": 4, "openSpace": True, "monthlyWaterBill": 900,
}


def event(method, body=None, plan_id=None, query=None, path=""):
    return {
        "rawPath": path,
        "requestContext": {"http": {"method": method, "path": path}},
        "pathParameters": {"id": plan_id} if plan_id else None,
        "queryStringParameters": query,
        "body": json.dumps(body) if body is not None else None,
    }


def call(handler, *args, **kwargs):
    res = handler(event(*args, **kwargs), None)
    return res["statusCode"], json.loads(res["body"])
