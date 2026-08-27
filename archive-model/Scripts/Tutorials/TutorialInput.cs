using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;

public class TutorialInput : MonoBehaviour
{
    // this is a slider type.

    public UnityEvent whenInputTriggered;
    public TutorialInputData inputData;
    public Slider slider;

    // Start is called before the first frame update
    void Start()
    {

    }

    // Update is called once per frame
    void Update()
    {

    }

    public void SetInput(float value, float target = 1)
    {
        inputData.SetInput(value, target);

        if (inputData.triggered)
        {
            whenInputTriggered.Invoke();
        }
    }

    public void TriggerManual()
    {
        inputData.SetInput(1, 1);
        whenInputTriggered.Invoke();
    }
}

[Serializable]
public class TutorialInputData
{
    public float inputValue;
    public float inputTarget;

    public void SetInput(float value, float target = 1)
    {
        inputValue = value;
        inputTarget = target;

        if (value == target)
        {
            triggered = true;
        }
    }

    public bool triggered = false;
}