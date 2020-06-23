/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import * as vscode from 'vscode';
import * as extension from '../extension';
import { DVProjectTreeNode } from '../model/tree/DVProjectTreeNode';
import * as utils from '../utils';
import * as kubectlapi from 'vscode-kubernetes-tools-api';
import { undeployVDBOnlyCommand } from './UndeployVDBCommand';
import { DVTreeItem } from '../model/tree/DVTreeItem';
import { EnvironmentVariableRefTreeNode } from '../model/tree/EnvironmentVariableRefTreeNode';
import { DataSourceRefTreeNode } from '../model/tree/DataSourceRefTreeNode';

export async function deployVDBOnlyCommand(prjNode: DVProjectTreeNode) {
	const overwrite: boolean | undefined = await isForcedOverwriteEnabled();
	if (overwrite === undefined) {
		return;
	}

	const alreadyDeployed: boolean = await utils.isVDBDeployed(prjNode.dvConfig.metadata.name);
	if (alreadyDeployed && overwrite) {
		await undeployVDBOnlyCommand(prjNode, true);
	}

	if (!alreadyDeployed || overwrite) {
		await handleDeploy(prjNode.file);
	}
}

export async function deployVDBFullCommand(prjNode: DVProjectTreeNode) {
	const overwrite: boolean | undefined = await isForcedOverwriteEnabled();
	if (overwrite === undefined) {
		return;
	}

	const filesToDeploy: string[] = new Array();

	// determine configmaps / secrets to deploy first
	filesToDeploy.push(...(await getReferenceFilesFromDataSources(prjNode, overwrite)));
	filesToDeploy.push(...(await getReferenceFilesFromEnvironment(prjNode, overwrite)));

	const alreadyDeployed: boolean = await utils.isVDBDeployed(prjNode.dvConfig.metadata.name);
	if (alreadyDeployed && overwrite) {
		await undeployVDBOnlyCommand(prjNode, true);
	}

	if (!alreadyDeployed || overwrite) {
		filesToDeploy.push(prjNode.file);
	}

	for (let file of filesToDeploy) {
		await handleDeploy(file);
	}
}

async function handleDeploy(file: string) {
	const k8sApi: kubectlapi.API<kubectlapi.KubectlV1> = await kubectlapi.extension.kubectl.v1;
	if (k8sApi && k8sApi.available) {
		try {
			const res: kubectlapi.KubectlV1.ShellResult = await k8sApi.api.invokeCommand(`create -f ${file}`);
			if (res.code === 0) {
				extension.log(`${res.stdout}`);
				vscode.window.showInformationMessage(`Deployment of ${file} succeeded. Check the output view for more details.`);
			} else {
				extension.log(`${res.stderr}`);
				vscode.window.showErrorMessage(`Deployment of ${file} failed. Please check the output view for more details.`);
			}
		} catch (error) {
			extension.log(error);
			vscode.window.showErrorMessage(`Deployment of ${file} failed. Please check the output view for more details.`);
		}
	} else {
		extension.log(`Unable to acquire Kubernetes API. Make sure you have configured Kubernetes correctly and you are logged in.`);
		vscode.window.showErrorMessage(`Unable to acquire Kubernetes API. Make sure you have configured Kubernetes correctly and you are logged in.`);
	}
}

async function isForcedOverwriteEnabled(): Promise<boolean | undefined> {
	const selection: string = await vscode.window.showQuickPick(['Overwrite', 'Skip'], {canPickMany: false, placeHolder: 'How should existing resources be handled?'});
	if (selection === undefined) {
		return undefined;
	} else if (selection === 'Overwrite') {
		return true;
	}
	return false;
}

export async function getReferenceFilesFromDataSources(prjNode: DVTreeItem, overwrite: boolean): Promise<string[]> {
	const filesToDeploy: string[] = new Array();
	for (let element of prjNode.getProject().getDataSourcesNode().children) {
		if (element instanceof DataSourceRefTreeNode) {
			const refDS: DataSourceRefTreeNode = element;
			const refFile: string = utils.getFullReferenceFilePath(prjNode.getProject().file, refDS.getReferenceName());
			const type: string = refDS.getReferenceType();
			try {
				const exists : boolean = await utils.isResourceDeployed(refDS.getReferenceName(), type);
				if (exists && overwrite) {
					await utils.undeployResource(refDS.getReferenceName(), type);
				}
				if ((!exists || overwrite) && filesToDeploy.indexOf(refFile) === -1) {
					filesToDeploy.push(refFile);
				}
			} catch (err) {
				extension.log(err);
			}
		}
	}
	return filesToDeploy;
}

export async function getReferenceFilesFromEnvironment(prjNode: DVTreeItem, overwrite: boolean): Promise<string[]> {
	const filesToDeploy: string[] = new Array();
	for (let element of prjNode.getProject().getEnvironmentNode().children) {
		if (element instanceof EnvironmentVariableRefTreeNode) {
			const refEnvVar: EnvironmentVariableRefTreeNode = element;
			const refFile: string = utils.getFullReferenceFilePath(prjNode.getProject().file, refEnvVar.getReferenceName());
			const type: string = refEnvVar.getReferenceType();
			const exists : boolean = await utils.isResourceDeployed(refEnvVar.getReferenceName(), type);
			if (exists && overwrite) {
				await utils.undeployResource(refEnvVar.getReferenceName(), type);
			}
			if ((!exists || overwrite) && filesToDeploy.indexOf(refFile) === -1) {
				filesToDeploy.push(refFile);
			}
		}
	}
	return filesToDeploy;
}
