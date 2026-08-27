
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class ThrusterEngine: MonoBehaviour{

    MaterialPropertyBlock propBlock;
    private Renderer mRenderer;
    public float initialStretchValue = .66f;
    public float initialMinNoiseValue = 0f;
    public float initialMaxNoiseValue = .35f;

    public float maxStretchValue = .66f;
    public float maxMinNoiseValue = 0f;
    public float maxMaxNoiseValue = .35f;

    const string stretch_prop_name = "_Stretch";
    const string min_max_noise_prop_name = "_random_min_Max";

    private void Start() {
        mRenderer = GetComponent<Renderer>();
        propBlock = new MaterialPropertyBlock();
        mRenderer.GetPropertyBlock(propBlock);
    }

    public void SetThrusterPower(float power){
        var currentValue = Mathf.Lerp(initialStretchValue, maxStretchValue, power) ;
        propBlock.SetFloat(stretch_prop_name, currentValue);

        var currentVector4Value = Vector4.Lerp(new Vector4(initialMinNoiseValue, initialMaxNoiseValue, 0, 0), new Vector4(maxMinNoiseValue, maxMaxNoiseValue, 0, 0), power);
        propBlock.SetVector(min_max_noise_prop_name, currentVector4Value);
        mRenderer.SetPropertyBlock(propBlock);
    }

}