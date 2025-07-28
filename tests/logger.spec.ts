import * as sinon from 'sinon';
import {configureLogger, logger} from "../src/logger";
import * as winston from "winston";

describe('parasoft-bitbucket/logger/configureLogger', () => {

    it('updates the logger configuration with provided options', () => {
        const options = { level: 'debug', transports: [new winston.transports.Http()] };
        configureLogger(options);
        sinon.assert.match(logger.level, 'debug');
        sinon.assert.match(logger.transports.length, 1);
        sinon.assert.pass(logger.transports[0] instanceof winston.transports.Http);
    });
});