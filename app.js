var request = require("request"),
    q = require("q"),
    xmlbuilder = require("xmlbuilder"),
    format = require("string-format");

var config =
{
    //generic PoEditor.com configuration
    poEditor: {
        apiUrl: "https://poeditor.com/api/",
        apiKey: "YOURAPIKEY",
        projectId: "40725" //the project where data should be loaded from
    },
    //naming conventions of specific terms
    poEditorTerms: {
        appName: "VoiceCommandAppName",
        commandPrefix: "VoiceCommandCommandPrefix",
        example: "VoiceCommandExample",
        commandExample: "{command}_Example",
        commandListenFor: "{command}_ListenFor",
        commandFeedback: "{command}_Feedback",
        phraseItems: "Phrase_{phrase}_DefaultItems"
    },
    //structure of the Voice Command Definition file
    vcdStructure: {
        "GetParkingLotData": {
            "VoiceCommandService": "VoiceCommandServiceEndpoint" //use a voice command service
        },
        "SelectCity": {
            "Navigate": true //navigate to the app
        },
        "SelectParkingLot": {
            "Navigate": true //navigate to the app
        }
    },
    //array of the labels of the phrase lists
    phraseLists: [
        "city",
        "parking_lot"
    ],
    //naming conventions of the command sets in the VCD file
    commandSetNameFormat: "ParkenDdCommands_{lang}"
};

var vcdXml = require("xmlbuilder").create("VoiceCommands", { version: "1.0", encoding: "utf-8" });
vcdXml.att("xmlns", "http://schemas.microsoft.com/voicecommands/1.2");

var promises = {};
var processLanguageList = function (data) {
    var langPromises = [];
    for (var i = 0; i < data.length; i++) {
        var langCode = data[i].code;
        var defer = q.defer();
        promises[langCode] = defer;
        langPromises.push(defer.promise);
        processLanguage(langCode);
    }
    q.all(langPromises).then(finished);
}

var processLanguage = function (languageCode) {
    request
        .post(config.poEditor.apiUrl, {
        form: {
            api_token: config.poEditor.apiKey,
            action: "export",
            id: config.poEditor.projectId,
            language: languageCode,
            type: "json"
        }
    }, function (error, response, body) {
        var data = JSON.parse(body);
        if (data.response.status === "success") {
            processExport(languageCode, data.item);
        }
    });
}

var processExport = function(languageCode, url) {
    request(url, function (error, response, body) {
        var terms = JSON.parse(body);
        processTerms(languageCode, terms);
    });
}

var findTerm = function(terms, key) {
    for (var i = 0; i < terms.length; i++) {
        if (terms[i].term === key) {
            return terms[i];
        }
    }
    return false;
}

var getCommandDetails = function(commandName, terms) {
    var result = {};
    var example = findTerm(terms, format(config.poEditorTerms.commandExample, { command: commandName }));
    if (example !== false) {
        result.example = example.definition;
    }
    var listenFor = findTerm(terms, format(config.poEditorTerms.commandListenFor, { command: commandName }));
    if (listenFor !== false) {
        var listenForObj = [];
        var lines = listenFor.definition.split("\n");
        for (var i = 0; i < lines.length; i++) {
            //look for {builtin:AppName}
            //if it is at the beginning only, crop it and use "BeforePhrase"
            //if it is at the end only, crop it and use "AfterPhrase"
            //if it is somewhere in the phrase, use "ExplicitlySpecified"
            //otherwise, use "BeforeOrAfterPhrase"

            var line = lines[i].trim();
            var appNamePos = line.indexOf("{builtin:AppName}");
            var appNameAtBegin = false, appNameAtEnd = false, appNameInBetween = false;
            var appNameMode = "BeforeOrAfterPhrase";
            if (appNamePos === 0) {
                line = line.substr(17).trim();
                appNameAtBegin = true;
                appNamePos = line.indexOf("{builtin:AppName}");
            }
            if (appNamePos === line.length - 17) {
                line = line.substr(0, line.length - 17).trim();
                appNameAtEnd = true;
            }
            if (appNamePos >= 0) {
                appNameInBetween = true;
            }
            if (appNameInBetween === true) {
                appNameMode = "ExplicitlySpecified";
            } else if (appNameAtBegin && !appNameAtEnd) {
                appNameMode = "BeforePhrase";
            } else if (!appNameAtBegin && appNameAtEnd) {
                appNameMode = "AfterPhrase";
            }
            if (line.length > 0) {
                listenForObj.push({
                    attr: {
                        "RequireAppName": appNameMode,
                    },
                    text: line
                });
            }
        }
        result.listenFor = listenForObj;
    }
    var feedback = findTerm(terms, format(config.poEditorTerms.commandFeedback, { command: commandName }));
    if (feedback !== false) {
        result.feedback = feedback.definition;
    }
    return result;
}

var finished = function() {
    console.log(vcdXml.end({ pretty: true }));
}

var processTerms = function (languageCode, terms) {
    var commandSet = vcdXml.ele("CommandSet", {
        "xml:lang": languageCode,
        "Name": format(config.commandSetNameFormat, { lang: languageCode })
    });
    
    var appName = findTerm(terms, config.poEditorTerms.appName);
    var commandPrefix = findTerm(terms, config.poEditorTerms.commandPrefix);
    if (appName !== false && commandPrefix === false) {
        commandSet.ele("AppName", appName.definition);
    }else if (appName === false && commandPrefix !== false) {
        commandSet.ele("CommandPrefix", commandPrefix.definition);
    }
    commandSet.ele("Example", findTerm(terms, config.poEditorTerms.example).definition);

    for (var commandName in config.vcdStructure) {
        if (config.vcdStructure.hasOwnProperty(commandName)) {
            var data = getCommandDetails(commandName, terms);
            var command = commandSet.ele("Command", {
                Name: commandName
            });
            if (typeof (data.example) !== "undefined") {
                command.ele("Example", data.example);
            }
            for (var k = 0; k < Math.min(data.listenFor.length, 10); k++) {
                command.ele("ListenFor", data.listenFor[k].attr, data.listenFor[k].text);
            }
            if (typeof (data.feedback) !== "undefined") {
                command.ele("Feedback", data.feedback);
            }
            if (config.vcdStructure[commandName]["Navigate"] === true) {
                command.ele("Navigate");
            } else if (typeof (config.vcdStructure[commandName]["VoiceCommandService"]) === "string") {
                command.ele("VoiceCommandService", {
                    "Target": config.vcdStructure[commandName]["VoiceCommandService"]
                });
            }
        }
    }
    
    for (var i = 0; i < config.phraseLists.length; i++) {
        var phraseList = commandSet.ele("PhraseList", {
            "Label": config.phraseLists[i]
        });
        var phraseTerm = findTerm(terms, format(config.poEditorTerms.phraseItems, { phrase: config.phraseLists[i] }));
        if (phraseTerm !== false) {
            var lines = phraseTerm.definition.trim().split("\n");
            for (var k = 0; k < lines.length; k++) {
                phraseList.ele("Item", lines[k]);
            }
        }
    };

    promises[languageCode].resolve();
}

request
    .post(config.poEditor.apiUrl, {
        form: {
            api_token: config.poEditor.apiKey,
            action: "list_languages",
            id: config.poEditor.projectId
        }
    }, function(error, response, body) {
        var data = JSON.parse(body);
        if (data.response.status === "success") {
            processLanguageList(data.list);
        }
    });