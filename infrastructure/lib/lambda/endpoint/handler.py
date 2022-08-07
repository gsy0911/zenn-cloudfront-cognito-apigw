import json


def lambda_handler(event: dict, context: dict):
    print(event)
    print(context)
    return {
        "statusCode": 200,
        "body": json.dumps({"message": "Hello, world!"}, ensure_ascii=False),
    }
